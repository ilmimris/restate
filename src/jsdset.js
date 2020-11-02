import uuid from 'uuid'
import ExpressionEngine from './expengine'
const esprima = require('esprima')

const MAX_ITERATION_CYCLE = 20
const MAX_CALCULATED_ROWS = 1000

/*
  Metadata structure:

  metadata => object-of {
    (set_type: <set_description>,)*
  };

  set_type => identifier;
  set_description => object-of {
    id(fields): array-of-(field_description)
    [, id(extend): string {valid set_type}]
    [, id(indexes): array-of-(field names)]
    [, row_validator: function { (fields)}]
  };

  field_description => object-of-{
    id(name): string,
    id(type): string ("string" | "int" | "float" | "date" | "dataset" | "link"),
    [id(title): string, ]
    [id(formula): string {valid algebraic formula}, ]
    [id(dataset): string {dataset name, for type === "link" or type === "dataset"}, ]
    [id(date_format): string {("dt", "d") for type === "date", representing date-time, date-only respectively}, ]
    [id(validator)]: function { () => {}}
  };
*/

const NUMBER_SEPARATORS = (function () {
  
  // default
  var res = {
    "decimal": ".",
    "thousand": ""
  };
  
  // convert a number formatted according to locale
  var str = parseFloat(1234.56).toLocaleString();
  
  // if the resulting number does not contain previous number
  // (i.e. in some Arabic formats), return defaults
  if (!str.match("1"))
    return res;
  
  // get decimal and thousand separators
  res.decimal = str.replace(/.*4(.*)5.*/, "$1");
  res.thousand = str.replace(/.*1(.*)2.*/, "$1");
  
  // return results
  return res;
})()

function stdFloatS(sFloat) {
  var re = new RegExp(NUMBER_SEPARATORS.thousand, 'g')
  return sFloat.replace(re, '').replace(NUMBER_SEPARATORS.decimal, '.')
}

function strToDate(v) {
  if (typeof(v) === 'string' && v.length < 10)
    return v
  var d = new Date(v)
  return (isNaN(d.getTime())) ? (typeof(v) === 'string' ? v : undefined) : d
}

const setvalConversionMatrix = {
  'string': {
    'string': v => v, 
    'int': v => Math.round(parseFloat(stdFloatS(v))), 
    'float': v => parseFloat(stdFloatS(v)), 
    'date': v => strToDate(v)
  },
  'number': {
    'string': v => v.toString().replace('.', NUMBER_SEPARATORS.decimal),
    'int': v => Math.round(v),
    'float': v => v
  },
  'boolean': {
    'string': v => v.toString(),
    'int': v => Number(v),
    'float': v => Number(v),
  },
  'undefined': {
    'string': v => '',
    'int': v => 0,
    'float': v => 0.0,
  },
}

function dateValueToStr(v, df) {
  return (
    v ? 
      (
        (v instanceof Date) ?       
          (
            `${v.getFullYear().toString().padStart(4, '0')}-${(v.getMonth() + 1).toString().padStart(2, '0')}-${v.getDate().toString().padStart(2, '0')}` + 
              (
                (df || 'd') === 'dt' ? 
                ` ${v.getHours().toString().padStart(2, '0')}:${v.getMinutes().toString().padStart(2, '0')}:${v.getSeconds().toString().padStart(2, '0')}` 
                : ''
              )
          ) 
          : v
      ) 
      : ''
  )
}

const getStrConversionMatrix = {
  'string': v => v,
  'int': v => (typeof(v) === 'number' && !isNaN(v)) ? v.toString() : '',
  'float': v => (typeof(v) === 'number' && !isNaN(v)) ? v.toString() : '',
  'date': (v, df) => dateValueToStr(v, df)
}

function safeConvertValue(fieldDef, value) {
  var convF = (setvalConversionMatrix[typeof(value)] || {})[fieldDef.type]
  
  if (convF) {
    try {
      return convF(value)
    }
    catch(err) {
      console.error(`Error converting value to field "${fieldDef.name}" dataset "${fieldDef.dataDef.typeName}"\nError: ${err.message}`)
      return undefined
    }
  }
  else
    return undefined
}

class Metadata {
  constructor (uiData = {}) {
    this.lsDataDefs = []
    this.dataDefs = {}
    this.uiData = uiData
  }

  load (mdJSON) {
    var i
    for (var dsetName in mdJSON) {
      var ddef = new DataDef(this, dsetName)
      ddef.load(mdJSON[dsetName])
      this.lsDataDefs.push(ddef)
      this.dataDefs[dsetName] = ddef
    }

    for (i = 0; i < this.lsDataDefs.length; ++i)
      this.lsDataDefs[i].setInh()

    for (i = 0; i < this.lsDataDefs.length; ++i)
      this.lsDataDefs[i].setupFields()

    for (i = 0; i < this.lsDataDefs.length; ++i)
      this.lsDataDefs[i].processFormula()

  }

  logFormula () {
    for (var i = 0; i < this.lsDataDefs.length; ++i)
      this.lsDataDefs[i].logFormula()
  }
}

class DataDef {
  constructor (owner, typeName) {
    this.metadata = owner
    this.typeName = typeName
    this.indexes = []
    this.defaultIndex = ''
    this.lsFieldDefs = []
    this.fieldDefs = {}
    this.lsAllFieldDefs = []
    this.allFieldDefs = {}
    this.allFieldNames = []
    this.parentField = undefined
    this.hasFormulaField = false
    this.fieldWithFormulas = []
    this.fieldWithDependants = []
    this.datasetFields = []
    this.linkFields = []
    this.rowValidator = null // (fields, rowObject) => [true, '']
    this.uiData = owner.uiData[typeName] || {}
  }

  isOfType (typeName) {
    var cdef = this
    while (cdef && cdef.typeName !== typeName)
      cdef = cdef.extend
    return Boolean(cdef)
  }

  load (ddJSON) {
    var fields = ddJSON.fields || []
    var i
    for (i = 0; i < fields.length; ++i) {
      var fdef = new FieldDef(this)
      fdef.load(fields[i])
      this.lsFieldDefs.push(fdef)
      this.fieldDefs[fdef.name] = fdef
    }
    this.sExtend = ddJSON.extend
    var indexes = Array.isArray(ddJSON.indexes) ? [...ddJSON.indexes] : [] // copy indexes instead of refering. we must keep the JSON immutable
    if (!Array.isArray(indexes))
      throw Error(`"indexes" property requires Array of string in "${this.typeName}"`)
    for (i = 0; i < indexes.length; ++i) {
      var idxFieldName = indexes[i]
      if (typeof(idxFieldName) !== 'string')
        throw Error(`"indexes" property requires Array of string in "${this.typeName}"`)
    var fieldDef = this.fieldDefs[idxFieldName]      
      if (!fieldDef)
        throw Error(`Indexed field "${idxFieldName}" does not exist in "${this.typeName}"`)
      if (fieldDef.type === 'dataset' || fieldDef.type === 'link') 
        throw Error(`Indexed field "${idxFieldName}" in "${this.typeName}" must have elementary data type`)
      fieldDef.indexed = true
    }
    this.indexes = indexes
    if (ddJSON.default_index && indexes.indexOf(ddJSON.default_index) >= 0) {
      this.defaultIndex = ddJSON.default_index
    }
    if (ddJSON.parent_field) {
      this.parentField = this.fieldDefs[ddJSON.parent_field]
      if (!this.parentField || this.parentField.type !== 'link')
        throw Error(`"parent_field" refers to undefined or invalid (non-link) field "${ddJSON.parent_field}" in "${this.typeName}"`)
    }
    this.rowValidator = typeof(ddJSON.row_validator) === 'function' ? ddJSON.row_validator : null
  }

  setInh () {
    this.extend = this.sExtend ? this.metadata.dataDefs[this.sExtend] : null
  }

  setupFields () { // add default fields and resolve inherited fields
    var i, fdef, fdefNew
    const uiFields = this.uiData.fields || {}

    fdef = new FieldDef(this)
    fdef.name = '__rowIndex'; fdef.type = 'int'; fdef.title = (uiFields.__rowIndex ? uiFields.__rowIndex.title : '') || 'index'; fdef.isSystem = true
    this.lsAllFieldDefs.push(fdef); this.allFieldDefs[fdef.name] = fdef

    fdef = new FieldDef(this)
    fdef.name = '__rowNo'; fdef.type = 'int'; fdef.title = (uiFields.__rowNo ? uiFields.__rowNo.title : '') || 'no'; fdef.isSystem = true
    this.lsAllFieldDefs.push(fdef); this.allFieldDefs[fdef.name] = fdef

    var ent = this.extend
    while (ent) {
      for (i = 0; i < ent.lsFieldDefs.length; ++i) {
        if (!ent.lsFieldDefs[i].isSystem) {
          fdef = ent.lsFieldDefs[i].cloneInh(this)
          this.lsAllFieldDefs.push(fdef)
          this.allFieldDefs[fdef.name] = fdef
          if (fdef.indexed)
            this.indexes.push(fdef.name)
        }
      }
      ent = ent.extend
    }
    for (i = 0; i < this.lsFieldDefs.length; ++i) {
      fdef = this.lsFieldDefs[i]
      fdef.solve()
      this.lsAllFieldDefs.push(fdef)
      this.allFieldDefs[fdef.name] = fdef
    }
    this.allFieldNames = this.lsAllFieldDefs.map((f) => f.name)
    for (i = 0; i < this.lsAllFieldDefs.length; ++i) {
      fdef = this.lsAllFieldDefs[i]
      if (fdef.type === 'dataset') {
        this.datasetFields.push(fdef)
      }
      else if (fdef.type === 'link') {
        this.linkFields.push(fdef)
      }
      else {
        const uiField = uiFields[fdef.name]
        if (uiField && typeof(uiField.lookup) === 'object' && 
          typeof(uiField.lookup.style) === 'object' && uiField.lookup.style.input) {

          // create checker field
          fdefNew = new FieldDef(this)
          var fName = '__chk_' + fdef.name
          fdefNew.name = fName; fdefNew.type = 'string'; fdefNew.title = fName; fdefNew.isSystem = true
          fdefNew.isLookupCheckField = true
          fdefNew.baseField = fdef
          this.lsAllFieldDefs.push(fdefNew); this.allFieldDefs[fdefNew.name] = fdefNew
        }

      }
    }
  }

  addDependantField (aField) {
    if (this.fieldWithDependants.indexOf(aField) < 0)
      this.fieldWithDependants.push(aField)
  }

  processFormula () {
    var allFieldDefs = this.lsAllFieldDefs
    var i, j 
    for (i = 0; i < allFieldDefs.length; ++i) {
      var fieldDef = allFieldDefs[i]
      if (fieldDef.formula) {
        try {
          var ast = esprima.parseScript(fieldDef.formula, {range: true, loc: true})
        }
        catch(err) {
          var newErrMsg = `Error parsing formula in field "${fieldDef.name}" in table "${fieldDef.dataDef.typeName}" \nFormula text: ${fieldDef.formula}\nError: ${err.message}`
          throw Error(newErrMsg)
        }
        var et = new ExpressionEngine()
        et.datasetTypeName = this.typeName
        et.onCheckVar = (id) => (this.allFieldNames.indexOf(id) >= 0 && this.allFieldDefs[id].isElementaryType())
        et.onCheckAttribute = (id, key) => {
            var fd = this.allFieldDefs[id]
            return (fd && fd.type === "link" && fd.targetDSType.allFieldNames.indexOf(key) >= 0)
          }
        et.onCheckAggregateMember = (aggfname, id, key) => {
            var fd = this.allFieldDefs[id]
            return fd && fd.type === "dataset" && fd.targetDSType.allFieldNames.indexOf(key) >= 0 && (
              ((aggfname === 'min' || aggfname === 'max') && ['int', 'date', 'float'].indexOf(fd.targetDSType.allFieldDefs[key].type) >= 0)
              ||
              ((aggfname === 'sum' || aggfname === 'avg') && ['int', 'float'].indexOf(fd.targetDSType.allFieldDefs[key].type) >= 0)
              ||
              (aggfname === 'count')
            )
          }
        et._body(ast.body)
        if (et.errFlag)
          throw Error(`Expression "${fieldDef.formula}" error. ${et.errMessage}`)
        fieldDef.rtFormula = et.gens_body(ast.body)
        for (j = 0; j < et.varNames.length; ++j) {
          fieldDef.addThisFVar(et.varNames[j])
        }
        
        for (j = 0; j < et.attrNames.length; ++j) {
          fieldDef.addLinkFVar(et.attrNames[j].id, et.attrNames[j].key)
        }

        for (j = 0; j < et.contextAttrNames.length; ++j) {
          fieldDef.addSubFVar(et.contextAttrNames[j].id, et.contextAttrNames[j].key)
        }

        this.hasFormulaField = true
        this.fieldWithFormulas.push(fieldDef)
      }
    }
  }

  logFormula () {
    var i, j

    for (i = 0; i < this.lsAllFieldDefs.length; ++i) {
      var fdef = this.lsAllFieldDefs[i]
      if (fdef.formula || fdef.targetFVars.length > 0 || Object.keys(fdef.targetFVarsContext).length > 0) {
        console.log(`Dataset "${this.typeName}" Field "${fdef.name}"`)
        if (fdef.formula) {
          console.log(`  Formula = ${fdef.formula}`)
          console.log(`  Runtime formula = ${fdef.rtFormula}`)
          if (fdef.srcFVars.length > 0) {
            console.log('  Formula variables: ')
            console.log('  -------------------------')
            for (j = 0; j < fdef.srcFVars.length; ++j) {
              console.log('    ' + fdef.srcFVars[j].getStrRepTarget())
            }
            console.log('')
          }
        }
        if (fdef.targetFVars.length > 0) {
          console.log('  Dependants: ')
          console.log('  -------------------')
          for (j = 0; j < fdef.targetFVars.length; ++j) {
            console.log('  ' + fdef.targetFVars[j].getStrRepSrc())
          }
          console.log('')
        }

        if (Object.keys(fdef.targetFVarsContext).length > 0) {
          console.log('  Context-sensitive dependants')
          console.log('  ----------------------------')
          var contextKeys = Object.keys(fdef.targetFVarsContext)
          for (j = 0; j < contextKeys.length; ++j) {
            var ckey = contextKeys[j]
            var arrFVars = fdef.targetFVarsContext[ckey]
            console.log('    Context:', ckey)
            for (var k = 0; k < arrFVars.length; ++k) {
              console.log('      ' + arrFVars[k].getStrRepSrc())
            }
            console.log('')
          }
        } 
      }
    }
  }
}

class FieldDef {
  constructor (owner) {
    this.id = uuid.v4()
    this.dataDef = owner
    this.isSystem = false

    // used for lookup checker field
    this.isLookupCheckField = false
    this.baseField = null

    this.metadata = owner.metadata
    this.dsTypeName = owner.typeName
    this.targetDSType = null
    this.indexed = false
    this.srcFVars = [] // list of formula variables that this field definition depends to
    this.targetFVars = [] // list of formula variables that depends to this field definition
    this.targetFVarsContext = {} // list of formula variables that depends to this field definition, specified per context of dataset (if positioned as subdataset)
    this.rtFormula = undefined // runtime version of formula
    this.linkSource = null

    // properties to be initalized from JSON
    this.name = ''
    this.type = ''
    this.title = ''
    this.formula = undefined
    this.dataset = undefined
    this.link_lookup_field = '' // string / int field can be used to lookup other link field from defined dataset name
    // link_lookup_field defines target field name of link lookup 
    this.link_src_name = undefined // dataset name where link value to be taken by default
    this.link_index_name = '' // used index to lookup, override defaultIndex property of link source

    this.validator = null // (value, fieldName) => [true, '']
  }

  asString (v) {
    var convF = getStrConversionMatrix[this.type]
    return convF ? convF(v) : ''
  }

  cloneInh (inhDef) {
    var newField = new FieldDef(inhDef)

    newField.targetDSType = this.targetDSType
    newField.indexed = this.indexed

    // properties to be initalized from JSON
    newField.name = this.name
    newField.type = this.type
    newField.title = this.title
    newField.formula = this.formula
    newField.dataset = this.dataset
    newField.link_lookup_field = this.link_lookup_field
    newField.link_src_name = this.link_src_name
    newField.link_index_name = this.link_index_name

    return newField
  }

  isElementaryType () {
    return ['string', 'int', 'float', 'date'].indexOf(this.type) >= 0
  }

  load (fdJSON) {
    Object.assign(this, fdJSON)
    if (this.validator && typeof(this.validator) != 'function')
      this.validator = null
  }

  solve () {  // solve dataset and formula
    if (this.type === 'dataset' || this.type === 'link') {
      if (!this.dataset)
        throw Error(`"dataset" property required in field "${this.name}" of data type "${this.dsTypeName}"`)
      this.targetDSType = this.metadata.dataDefs[this.dataset]
      if (!this.targetDSType)
        throw Error(`cannot resolve "dataset" value property ("${this.dataset}") in field "${this.name}" of data type "${this.dsTypeName}"`)
      if (this.type === 'dataset') {
        var parentField = this.targetDSType.parentField
        if (parentField && (parentField.type !== 'link' || !this.dataDef.isOfType(parentField.dataset))) {
          throw Error(`Incompatible type declaration in parent field of "${this.targetDSType.typeName}" (checked in field "${this.name}" of "${this.dataDef.typeName}")`)
        }         
      }
    }
  }

  addThisFVar (varName) {
    var srcFieldDef = this.dataDef.allFieldDefs[varName]
    if (srcFieldDef === this) // check for circular reference should be more complex, but not implemented yet
      throw Error(`Circular reference in formula of field "${this.name}" in data definition "${this.dataDef.typeName}" `)
    var fvar = new FVar(this, srcFieldDef, varName, 'this')  
    this.srcFVars.push(fvar)
    srcFieldDef.targetFVars.push(fvar)
    srcFieldDef.dataDef.addDependantField(srcFieldDef)
  }

  addLinkFVar (linkId, linkFieldId) {
    var srcLinkDef = this.dataDef.allFieldDefs[linkId]
    var srcFieldDef = srcLinkDef.targetDSType.allFieldDefs[linkFieldId]

    // check circular reference
    // not implemented yet

    var fvar = new FVar(this, srcFieldDef, linkId, 'link')  
    this.srcFVars.push(fvar)
    srcFieldDef.targetFVars.push(fvar)
    srcFieldDef.dataDef.addDependantField(srcFieldDef)

    this.addThisFVar(linkId)
  }

  addSubFVar (subId, subFieldId) {
    var srcSubDef = this.dataDef.allFieldDefs[subId]
    var srcFieldDef = srcSubDef.targetDSType.allFieldDefs[subFieldId]

    // check circular reference
    // not implemented yet
    var fvar = new FVar(this, srcFieldDef, subId, 'sub', this.dataDef.typeName + '|' + subId)  
    this.srcFVars.push(fvar)
    var ctxTargets = srcFieldDef.targetFVarsContext
    var ctxName = this.dataDef.typeName + '|' + subId
    if (!(ctxName in ctxTargets)) {
      var arrFVars = []
      ctxTargets[ctxName] = arrFVars
    } else {
      var arrFVars = ctxTargets[ctxName]
    }
    arrFVars.push(fvar)
    srcFieldDef.dataDef.addDependantField(srcFieldDef)
  }


}

class DataStore {

  constructor (md) {
    this.metadata = md
    this.updateQueues = []
    this.datasets = {}
    this.stateVersion = 0 // used to sync state management with react dispatch/setState 
  }

  /*
    dataMap => object-of-{
      (dataKeyName: object-of-{
        id(dset): string(dataset name),
        id(type): string(dataset datadef name),
        [id(fieldMapping): fieldMap]
      })*
    }

    fieldMap => object-of-{
      (linkTypeMapping || fieldTypeMapping || datasetTypeMapping)*
    }

    fieldTypeMapping => srcFieldName: string(destination field name) || "*": true
    linkTypeMapping => srcFieldName: object-of-{
      id(link): string(linkName),
      id(dset): string(dataset name to link)
      [id(index): string(index of linked dataset, default index if omitted)]
      id(fieldMapping): {
        (fieldName: string(designated field))*
      }
    }

    datasetTypeMapping => srcFieldName: object-of-{
      dsetField: string(dataset field name),
      id(fieldMapping): fieldMap
    }
  */

  // load: load json to data store
  // possible data format: 'std' (for standard json data) or 'fmap' (for data with fieldmap and array records)
  load (json, dataFormat = 'std', dataMapping = undefined, markLoadFlag = false, stateVersion = undefined) { 
    var data, dataKey, dsetName, dsetTypeName, dsetType, dset, mapInfo, fieldMapping

    if (!this.__checkStateVersion(stateVersion))
      return

    this.reset()
    if (dataFormat === 'std') {
      data = json
    } else if (dataFormat === 'fmap') {
      data = json.data
    }
    else
      throw Error(`Invalid data format setting: ${dataFormat}`)

    for (dataKey in data) {
      if (!dataMapping) {
        dsetName = dataKey.split(':').slice(0, 1)[0];
        dsetTypeName = dataKey.split(':').slice(1)[0];
        dsetType = this.metadata.dataDefs[dsetTypeName];
        fieldMapping = undefined
      }
      else {
        mapInfo = dataMapping[dataKey]
        dsetName = mapInfo ? mapInfo.dset : undefined
        dsetTypeName = mapInfo ? mapInfo.type : undefined
        if (!dsetName || !dsetTypeName)
          continue
        dsetType = this.metadata.dataDefs[dsetTypeName]
        fieldMapping = mapInfo.fieldMapping
      }

      if (!dsetType) throw Error(`Dataset "${dsetTypeName}" not found`);

      dset = this.datasets[dsetName]
      if (!dset) {
        dset = new Dataset(dsetName)
        dset.initNew(this, dsetType)
        this.datasets[dsetName] = dset
      }
      else {
        if (dset.dataDef !== dsetType) {
          throw Error(`Loading data to dataset "${dsetName}": dataset already exists with different data definition than "${dsetTypeName}"`)
        }
      }

      if (dataFormat === 'std') {
        dset.load(data[dataKey], dataFormat, fieldMapping, markLoadFlag) // load with records
      }
      else if (dataFormat === 'fmap') {
        var arrFieldMap = json.arrFieldMap
        if (!arrFieldMap) {
          throw Error(`Invalid data (arrFieldMap attribute required)`)
        }
        dset.load({arrFieldMap: arrFieldMap, data: data[dataKey]}, dataFormat, fieldMapping, markLoadFlag) // load with records
      }    
    }

    for (dsetName in this.datasets) {
      this.datasets[dsetName].solveLinks()
    }
    this.recalcFormulas()
  }

  unload (dataFormat = 'std', dataMapping = undefined, options = {}) { // options is object having keys: includeLoadedRows, includeDeletedRows

    var result = {}
    var dsetName, mapInfo

    if (!dataMapping || (typeof(dataMapping) == 'object' && !Array.isArray(dataMapping) && Object.keys(dataMapping).length === 0)) {
      dataMapping = Object.fromEntries(Object.keys(this.datasets).map((dsetName) => [dsetName, {dset: dsetName}]))
    }

    for (var targetName in dataMapping) {
      mapInfo = dataMapping[targetName]
      dsetName = mapInfo.dset     
      var dataset = this.datasets[dsetName]
      if (!dataset)
        continue

      result[targetName] = dataset.unload(dataFormat, mapInfo.fieldMapping || {'*': true}, options)
    }

    return result
  }

  reset (stateVersion) {
    if (!this.__checkStateVersion(stateVersion))
      return
    var dsetNames = Object.keys(this.datasets)
    dsetNames.forEach((dsetName) => {
      var dset = this.datasets[dsetName]
      dset.stamp()
      dset.reset()
    })
  }

  addDataset (dsetName, dsetTypeName) {
    if (dsetName in this.datasets) {
      throw Error(`Dataset named "${dsetName}" is already in datastore`)
    }
    var dsetType = this.metadata.dataDefs[dsetTypeName]
    if (!dsetType) throw Error(`Dataset "${dsetTypeName}" not found`)

    var dset = new Dataset(dsetName)
    dset.initNew(this, dsetType)
    this.datasets[dsetName] = dset
    return dset
  }

  createDatasetForRow(dsetType, ownerRow, fieldName) {
    var dset = new Dataset(fieldName)
    dset.initNew(ownerRow, dsetType)
    return dset
  }

  solveLink (paths) { // every member of paths must have 'dset', and indexed key name properties
    // for single path, paths can be simplified into single object
    var arrPath = Array.isArray(paths) ? paths : [paths]

    var ds, row, indexKey
    for (var i = 0; i < arrPath.length; ++i) {
      var pathEl = arrPath[i]
      ds = (i === 0) ? this.datasets[pathEl.dset] : row.fields[pathEl.dset]

      for (var objKey in pathEl) {
        if (objKey !== 'dset') {
          indexKey = objKey
          break
        }
      }
      if (ds && indexKey) {
        var idx = ds.indexes[indexKey]
        var r = idx ? idx[pathEl[indexKey]] : undefined
        row = Array.isArray(r) ? r[0] : r
      }
      else
        row = undefined
    }
    return row
  }

  findDataset (dsetPath, ownerRow) {
    var paths = dsetPath.split('.')
    var cdset
    for (var i = 0; i < paths.length; ++i) {
      cdset = i === 0 ? (ownerRow ? ownerRow.fields[paths[i]] : this.datasets[paths[i]]) : 
        (cdset.getActiveRow() ? cdset.getActiveRow().fields[paths[i]] : undefined)
      if (!cdset)
        break
    }
    return cdset
  }

  findRow (rowPath, ownerRow) {
    if (typeof(rowPath) === 'object' && !(rowPath instanceof Row)) {
      if (!Array.isArray(rowPath)) {
        var dsetPath = rowPath.dset
        var dset = this.findDataset(dsetPath, ownerRow)
        if (dset) {
          if (rowPath.irow) {
            var e = Object.entries(rowPath.irow)[0]
            return e ? dset.findIndexedRow(e[0], e[1]) : undefined
          }
          else if (rowPath.row) {
            var r = rowPath.row
            return (typeof(r) === 'string') ? dset.rowIds[r] : undefined
          }
          else {
            return dset.getActiveRow()
          }
        }
      }
      else {
        for (var i = 0; i < rowPath.length; ++i) {
          var row = this.findRow(rowPath[i], i === 0 ? ownerRow : row)
          if (!row)
            break
        }
        return row
      }
    }
    else if (typeof(rowPath) === 'string') {
      var dset = this.findDataset(rowPath, ownerRow)
      return dset ? dset.getActiveRow() : undefined
    }
  }

  clone (modifiedDS, newDataset) {
    var res = new DataStore(this.metadata)
    Object.assign(res, this)
    if (modifiedDS) {
      res.datasets[modifiedDS] = newDataset
    }
    return res
  }

  recalcFormulas () {
    for (var dsetName in this.datasets) {
      this.datasets[dsetName].recalcFormulas()
    }
  }

  /*
    updArray. array of update instructions, will be processed sequentially
    updateArray => array of (update_instruction)
    update_instruction => object-of-{
      id(inst): string ("set", "del", "add", "insert", "clear")
      inst === "set" ? (
        id(row): row_path
        id(values): field_values
      )
      :
      inst === "del" ? (
        id(row): row_path
      )
      :
      inst === "add" || inst === "insert" ? (
        [id(row): row_path,]
        id(dset): dataset_path,
        id(values): field_values,
        [id(before_row): integer]
      )
      :
      inst === "clear" ? (
        [id(row): row_path,]
        id(dset): dataset_path,
      )
      :
      empty
    }

    row_path => dataset_path | object-of-{
      id(dset): dataset_path,
      (id(irow): {index_field_name: indexed_field_value}) |
      (id(row): string (`string designating row_id`) | id (`variable to row object`)) | array-of-(row_path)
    }

    dataset_path => string (path_element || ("." || path_element)*)
    path_element => string (identifier)

    // row_path examples:
    // aRow // single object instanceof Row class
    // {dset: 'car', irow: {code: 'MBNT'}} // single object with path and index key, row is optional otherwise active row
    // [{dset: 'main', irow: {ssid: '3273xxxx'}}]
    // [{dset: 'main'}, {dset: 'children', irow: {order: 5}}] // array of path, key can be specified otherwise active row. last element must contain row specifier
    // {dset: 'car', row: 'a2fa7795-6446-4486-8a4f-e57f66e2fcf3'} // single object with row ID
    // {dset: 'main.children'} // single object, active row

    updOptions => object-of {
      [id(deferFormula): false/true,]
      [id(overrideFormula: false/true)]
    }
  */

  __update (updArray, updOptions) {
    
    const mergeTargets = (targets) => {
      var rows = {}
      var rowFields = {}
      for (var i = 0; i < targets.length; ++i) {
        var target = targets[i]
        var rowId = target.row.rowId
        rows[rowId] = target.row
        if (!(rowId in rowFields)) 
          rowFields[rowId] = {}
        rowFields[rowId][target.fieldName] = target.fieldValue // fieldValue can be predefined, or undefined to force recalculation 
      }
      return {rows, rowFields}
    }

    const recalcTargets = ({rows, rowFields}) => {

      for (var rowId in rowFields) {
        var row = rows[rowId]
        var fieldNamesAndVals = rowFields[rowId]
        rowFields[rowId] = row.recalcFormulaFields(false, fieldNamesAndVals) // set back values
      }

      // console.log('merge targets')
      // console.log('rows: ', Object.keys(rows))
      // console.log('rowFields: ', Object.keys(rowFields))
      return {rows, rowFields}
    }

    const mergeUpdate = (updatedRows, updatedRowFields, newRows, newRowFields) => {

      var fieldValues = {}

      Object.assign(updatedRows, newRows)
      for (var rowId in newRowFields) {
        var updFields = newRowFields[rowId]
        if (!(rowId in updatedRowFields)) {
          fieldValues = {}
          updatedRowFields[rowId] = fieldValues
        }
        else
          fieldValues = updatedRowFields[rowId]
        Object.assign(fieldValues, updFields)
      }
    }

    const setOp = (row, values) => {
      var dataDef = row.dataDef
      var dataset = row.dataset
      var targets = []
      var changes = false

      var prevFlag = row.fields.__sysFields.loadFlag

      for (var vk in values) {
        var fieldDef = dataDef.allFieldDefs[vk]
        if (!fieldDef || fieldDef.type === 'dataset' || (fieldDef.formula && !updOptions.overrideFormula))
          continue
        if (fieldDef.type !== 'link') {
          var exval = row.fields[vk]; var nval = values[vk]
          if (fieldDef.indexed && exval !== nval) {
            // check index
            dataset.removeIndexRow(vk, exval, row)
            dataset.indexRow(vk, nval, row)
          }
          row.fields[vk] = safeConvertValue(fieldDef, nval)
          row.validateField(vk)

          changes = true
          if (fieldDef.link_lookup_field) {
            if (!fieldDef.linkSource)
              fieldDef.linkSource = row.dataStore.datasets[fieldDef.link_src_name]
            var lookupIndex = fieldDef.linkSource && (fieldDef.link_index_name || fieldDef.linkSource.defaultIndex)
            if (lookupIndex) {
              var rowValue = fieldDef.linkSource.indexes[lookupIndex][nval]
              targets.push({row, fieldName: fieldDef.link_lookup_field, fieldValue: rowValue})
            }
          }
        }
        else {
          // link can be set using reference object or may be undefined
          nval = (values[vk] instanceof Row || values[vk] === undefined) ? values[vk] : this.solveLink(values[vk])
          row.link(vk, nval, false)
          row.validateField(vk)
          changes = true
        }        
        
        if (!updOptions.deferFormula) {
          for (var j = 0; j < fieldDef.targetFVars.length > 0; ++j) {
            targets.push(...fieldDef.targetFVars[j].getRecalcTargets(row))
          }
          if (row.parentRow) {
            var contextTargets = fieldDef.targetFVarsContext[row.parentRowTypeName + '|' + row.parentRowFieldName]
            if (contextTargets)
              for (var j = 0; j < contextTargets.length; ++j)
                targets.push(...contextTargets[j].getRecalcTargets(row))
          }
        } // if (!updOptions.deferFormula)
      } // for
      if (changes) {
        row.stamp()
        row.setLoadFlag((prevFlag === 'L') ? 'U' : prevFlag)
        row.validate()
      }
      return targets
    }

    const __delOp = (row, targets, isRecurse) => {
      var dataDef = row.dataDef
      var dataset = row.dataset
      var fdef, fname

      // recurse to subdatasets
      for (var i = 0; i < dataDef.datasetFields.length; ++i) {
        fdef = dataDef.datasetFields[i]
        var dset = row[fdef.name]
        if (dset) {
          for (var j = dset.rows.length - 1; j >= 0; --j)
            __delOp(dset.rows[j], targets, true)
        }
      }

      if (!updOptions.deferFormula) {
        for (var i = 0; i < dataDef.fieldWithDependants.length; ++i) {
          fdef = dataDef.fieldWithDependants[i]
          for (var j = 0; j < fdef.targetFVars.length > 0; ++j) {
            var target = fdef.targetFVars[j]
            if (target.relType !== 'this') // ignore "this" dependants, because all row contents will be removed
              targets.push(...fdef.targetFVars[j].getRecalcTargets(row))
          }
          if (!isRecurse && row.parentRow) {
            var contextTargets = fdef.targetFVarsContext[row.parentRowTypeName + '|' + row.parentRowFieldName]
            if (contextTargets)
              for (var j = 0; j < contextTargets.length; ++j)
                targets.push(...contextTargets[j].getRecalcTargets(row))
          }
        }
      } // if (!updOptions.deferFormula)

      row.cleanUp() // remove from index and referrers
      row.resetFieldValues() // reset values and links
      row.stamp()
      row.dataset.removeRow(row) // remove the row itself
    }

    const delOp = (row) => {
      var targets = []

      __delOp(row, targets, false)
      return targets
    }

    const clearOp = (dset) => {
      var targets = []

      for (var i = dset.rows.length - 1; i >= 0 ; --i) {
        var row = dset.rows[i]
        __delOp(row, targets, false)
      }

      return targets
    }

    var updatedRows = {}, updatedRowFields = {}
    var row, ownerRow, newrow, dset
    var mtResult
    updOptions = updOptions ? updOptions : {}

    for (var i = 0; i < updArray.length; ++i) {
      var updInst = updArray[i]
      var instType = updInst.inst
      var newRows = {}, newRowFields = {}
      var recalcResult = {newRows, newRowFields}

      if (instType === 'set') {
        if (!updInst.row)
          throw Error(`"row" not specified in update instruction`)
        row = (updInst.row instanceof Row) ? updInst.row : this.findRow(updInst.row)
        if (!row || !updInst.values)
          continue
        recalcResult = recalcTargets(mergeTargets(setOp(row, updInst.values)))
      }
      else if (instType === 'del') {
        if (!updInst.row)
          throw Error(`"row" not specified in update instruction`)
        row = (updInst.row instanceof Row) ? updInst.row : this.findRow(updInst.row)
        if (!row)
          continue
        recalcResult = recalcTargets(mergeTargets(delOp(row)))
      }
      else if (instType === 'add' || instType === 'insert') {
        if (!updInst.dset)
          throw Error(`"dset" not specified in "add"/"insert" instruction`)
        ownerRow = updInst.owner_row ? ((updInst.owner_row instanceof Row) ? updInst.owner_row : this.findRow(updInst.owner_row)) : undefined
        dset = this.findDataset(updInst.dset, ownerRow)
        if (!dset)
          continue
        newrow = dset.addRow({}, (updInst.before_row || updInst.before_row === 0) ? updInst.before_row : undefined)
        newrow.setLoadFlag('N')
        var fValues = {}
        Object.assign(fValues, newrow.fields) // assign default fields
        Object.assign(fValues, updInst.values ? updInst.values : {}) // assign custom fields
        recalcResult = recalcTargets(mergeTargets(setOp(newrow, fValues)))
      }
      else if (instType === 'clear') {
        if (!updInst.dset)
          throw Error(`"dset" not specified in "clear" instruction`)
        ownerRow = updInst.owner_row ? ((updInst.owner_row instanceof Row) ? updInst.owner_row : this.findRow(updInst.owner_row)) : undefined
        dset = this.findDataset(updInst.dset, ownerRow)
        if (!dset)
          continue
        recalcResult = recalcTargets(mergeTargets(clearOp(dset)))
      }

      mergeUpdate(updatedRows, updatedRowFields, recalcResult.rows, recalcResult.rowFields)
    } // for
    return {updatedRows, updatedRowFields}
  }

  __checkStateVersion (stateVersion) {
    var check = !(stateVersion || stateVersion === 0) || (stateVersion >= this.stateVersion)
    // console.log(`checkStateVersion() invoked. stateVersion ${stateVersion} this.stateVersion ${this.stateVersion}`)
    if ((stateVersion || stateVersion === 0) && check) {
      this.stateVersion += 1
    }
    return check
  }

  update (updArray, updOptions, stateVersion) {
    var itrCount, rowCount, updArray
    updOptions = updOptions ? updOptions : {}

    if (!this.__checkStateVersion(stateVersion))
      return

    itrCount = 0
    do {
      var {updatedRows, updatedRowFields} = this.__update(updArray, updOptions)
      rowCount = 0
      updArray = [] // reset updArray
      for (var rowId in updatedRowFields) {
        var fieldUpds = updatedRowFields[rowId]
        var row = updatedRows[rowId]
        updArray.push({inst: 'set', row: row, values: fieldUpds})
        rowCount += 1
        if (rowCount > MAX_CALCULATED_ROWS)
          throw Error('Maximum number of rows for formula propagation was exceeded')
      }
      updOptions.overrideFormula = true
      itrCount += (updArray.length > 0 ? 1 : 0)
    } while (itrCount <= MAX_ITERATION_CYCLE && updArray.length > 0)
    if (itrCount > MAX_ITERATION_CYCLE)
      throw Error('Maximum number of iteration for formula propagation was exceeded')
  }

  navigate (inst, containerRowPath, dsetPath, stateVersion) {
    var containerRow
    var dset

    if (!this.__checkStateVersion(stateVersion))
      return true

    if (containerRowPath)
      containerRow = this.findRow(containerRowPath)
    dset = this.findDataset(dsetPath, containerRow)
    if (dset)
      return dset.navigate(inst)
  }

  goto (dsetPath, rowIndex, rowId, indexField, value, stateVersion) {

    if (!this.__checkStateVersion(stateVersion))
      return true

    var ds = this.findDataset(dsetPath)
    if (ds) {
      ds.goto({rowIndex, rowId, indexField, value})
      return true
    }
    else
      return false
  }

  loadDataset (dsetPath, json, dataFormat, markLoadFlag, stateVersion) {

    if (!this.__checkStateVersion(stateVersion))
      return true

    var ds = this.findDataset(dsetPath)
    if (ds) {
      this.update([{inst: 'clear', dset: dsetPath}])
      ds.load(json, dataFormat || 'std', undefined, markLoadFlag)
      return true
    }
    else
      return false
  }
}

class Dataset {

  constructor (name) {
    this.name = name
    this.unresolvedLinks = [] // array of row-field links to be resolved
    this.indexes = {}
    this.rowIds = {}
    this.rowsStamp = 0 // this field is incremented every time change occurs in any of rows
    this.delLoadedRows = [] // deleted loaded rows
    this.validationState = {} // validation state for all fields
  }

  initNew (dataStoreOrRow, dataDef) {
    if (dataStoreOrRow instanceof Row) {
      var ownerRow = dataStoreOrRow
      this.dataStore = ownerRow.dataset.dataStore
      this.ownerRow = ownerRow
      this.rowFieldName = this.name
    }
    else {
      this.dataStore = dataStoreOrRow
    }
    this.dataDef = dataDef
    this.typeName = dataDef.typeName
    this.metadata = this.dataStore.metadata
    this.rows = []
    this.rowFields = []
    this.activeRow = -1
    for (var i = 0; i < dataDef.indexes.length; ++i) {
      this.indexes[dataDef.indexes[i]] = {}
    }
  }

  stamp () {
    this.rowsStamp += 1
    if (this.ownerRow)
      this.ownerRow.stamp()
  }

  isOfType (dataDef) {
    var cdef = this.dataDef
    while (cdef && cdef !== dataDef) {
      cdef = cdef.extend
    }
    return Boolean(cdef)
  }

  load (json, dataFormat, fieldMapping, markLoadFlag = false) {
    var data, rowFieldMapping, rfmFields, includeUnmappedFields = false

    const checkLinkMapIndex = (linkMapObject) => {
      var fieldDef = this.dataDef.allFieldDefs[linkMapObject.link]
      var targetDSet = this.dataStore.datasets[linkMapObject.dset]

      if (fieldDef && fieldDef.type === 'link' && targetDSet) {
        // should check inheritance. not implemented yet
        var indexName = linkMapObject.index || targetDSet.dataDef.defaultIndex
        return (targetDSet.dataDef.indexes.indexOf(indexName) >= 0) ? indexName : undefined
      }
    }

    const checkDSetMap = (dsetMapObject) => {
      var fieldDef = this.dataDef.allFieldDefs[dsetMapObject.dsetField]
      
      return fieldDef.type === 'dataset'
    }

    // json is array of rows
    if (!Array.isArray(json))
      throw Error('array is required as dataset initializer')

    if (dataFormat === 'std')
      data = json
    else if (dataFormat === 'fmap') {
      data = json.data
    }

    if (fieldMapping) {
      rfmFields = {}
      var fieldMapKeys = Object.keys(fieldMapping)
      if (fieldMapping['*']) {
        fieldMapKeys.splice(fieldMapKeys.indexOf('*'), 1)
        includeUnmappedFields = true
      }
      else {
        includeUnmappedFields = false
      }
      fieldMapKeys.forEach((sourceName) => {
        var mappedObject = fieldMapping[sourceName]
        
        if (typeof(mappedObject) === 'object' && 'link' in mappedObject) {
          var indexName = checkLinkMapIndex(mappedObject)
          if (indexName) {
            var linkFieldMapping = {...(mappedObject.fieldMapping || {})}
            Object.keys(linkFieldMapping).forEach((sourceFName) => { // create void mapping for link attributes
              rfmFields[sourceFName] = undefined
            })
            rfmFields[sourceName] = {...mappedObject, mapType: 'link', index: indexName}
          }
        }
        else if (typeof(mappedObject) === 'object' && 'dsetField' in mappedObject && checkDSetMap(mappedObject)) {
          rfmFields[sourceName] = {...mappedObject, mapType: 'dataset'}
        }
        else if (typeof(mappedObject) === 'string' || Array.isArray(mappedObject) ) {
          var fieldDef = this.dataDef.allFieldDefs[mappedObject]
          if (fieldDef && fieldDef.isElementaryType()) {
            rfmFields[sourceName] = {mapType: 'field', targetField: mappedObject, }
          }
        }
      })
      rowFieldMapping = {incUnmapped: includeUnmappedFields, fields: rfmFields}
    }
    else
      rowFieldMapping = undefined

    for (var i = 0; i < data.length; ++i) {
      var row = new Row()
      if (dataFormat === 'std')
        row.initAndLoad(this, data[i], dataFormat, rowFieldMapping, markLoadFlag)
      else if (dataFormat === 'fmap')
        row.initAndLoad(this, {arrFieldMap: json.arrFieldMap, data: data[i]}, dataFormat, rowFieldMapping, markLoadFlag)
      this.rows.push(row)
      this.rowFields.push(row.fields)
      this.rowIds[row.rowId] = row
      row.rowIndex = this.rows.length - 1
      row.rowNo = row.rowIndex + 1
      row.fields.__rowNo = row.rowNo
      row.fields.__rowIndex = row.rowIndex

      row.indexFields()
      row.validateAll(true)
    }
    this.activeRow = this.rows.length - 1
  }

  unload (dataFormat = 'std', fieldMapping = {}, options) {
    var data, fieldDef, rfmFields

    const checkLinkMapIndex_unload = (linkMapObject) => {
      var fieldDef = this.dataDef.allFieldDefs[linkMapObject.link]

      if (fieldDef && fieldDef.type === 'link') {
        var targetDSetType = fieldDef.targetDSType
        // should check inheritance. not implemented yet
        var indexName = linkMapObject.index || targetDSetType.defaultIndex

        return (targetDSetType.indexes.indexOf(indexName) >= 0) ? indexName : undefined
      }
    }

    const checkDSetMap_unload = (dsetMapObject) => {
      var fieldDef = this.dataDef.allFieldDefs[dsetMapObject.dsetField]
      
      return fieldDef.type === 'dataset'
    }

    rfmFields = {}
    var fieldMapKeys = Object.keys(fieldMapping)
    if (fieldMapping['*']) {
      fieldMapKeys.splice(fieldMapKeys.indexOf('*'), 1)
      for (var i = 0; i < this.dataDef.lsAllFieldDefs.length; ++i) {
        var fieldDef = this.dataDef.lsAllFieldDefs[i]
        if (fieldDef.isElementaryType()) {
          rfmFields[fieldDef.name] = {mapType: 'field', srcField: fieldDef.name}
        }
      }
    }

    const { includeLoadedRows, includeDeletedRows } = options

    fieldMapKeys.forEach((targetName) => {
      var mappedObject = fieldMapping[targetName]
      
      if (typeof(mappedObject) === 'object' && 'link' in mappedObject) {
        var indexName = checkLinkMapIndex_unload(mappedObject)
        if (indexName) {
          rfmFields[targetName] = {...mappedObject, mapType: 'link', index: indexName, srcField: mappedObject.link}
        }
      }
      else if (typeof(mappedObject) === 'object' && 'dsetField' in mappedObject && checkDSetMap_unload(mappedObject)) {
        rfmFields[targetName] = {...mappedObject, mapType: 'dataset', srcField: mappedObject.dsetField}
      }
      else if (typeof(mappedObject) === 'string') {
        var fieldDef = this.dataDef.allFieldDefs[mappedObject]
        if (fieldDef && fieldDef.isElementaryType()) {
          rfmFields[targetName] = {mapType: 'field', srcField: mappedObject}
        }
      }
    })

    var data = []

    for (var i = 0; i < this.rows.length; ++i) {
      var row = this.rows[i]
      var loadFlag = row.fields.__sysFields.loadFlag
      if (!includeLoadedRows && loadFlag === 'L')
        continue
      var rowData = row.unload(dataFormat, rfmFields, options)
      rowData.__loadFlag = loadFlag
      data.push(rowData)
    }

    if (includeDeletedRows) {
      for (var i = 0; i < this.delLoadedRows.length; ++i) {
        var row = this.delLoadedRows[i]
        var rowData = row.unload(dataFormat, rfmFields, options)
        rowData.__loadFlag = loadFlag
        rowData.__deleted = true
        data.push(rowData)
      }
    }

    return data
  }

  indexRow (fieldName, fieldValue, row) {
    var idx = this.indexes[fieldName]

    var xval = idx[fieldValue]
    if (!xval)
      idx[fieldValue] = row
    else {
      if (Array.isArray(xval) && xval.indexOf(row) < 0)
        xval.push(row)
      else if (xval instanceof Row && xval !== row)
        idx[fieldValue] = [xval, row]
    }
  }

  removeIndexRow (fieldName, fieldValue, row) {
    var idx = this.indexes[fieldName]
    var xval = idx[fieldValue]

    if (Array.isArray(xval)) {
      var iPos = xval.indexOf(row)
      if (iPos >= 0) {
        xval.splice(iPos, 1)
        if (xval.length === 1)
          idx[fieldValue] = xval[0]
        else if (xval.length === 0) // this case should be unlikely
          delete idx[fieldValue]
      }
    }
    else
    if (xval === row)
      delete idx[fieldValue]
  }

  removeRow (row) {
    var rows = this.rows
    if (row.dataset !== this)
      return

    var idx = row.rowIndex
    for (var i = idx + 1; i < rows.length; ++i) {
      var nRow = rows[i]
      nRow.rowIndex -= 1
      nRow.rowNo = nRow.rowIndex + 1
      nRow.fields.__rowIndex = nRow.rowIndex
      nRow.fields.__rowNo = nRow.rowNo
      nRow.stamp()
    }
    rows.splice(idx, 1)
    this.rowFields.splice(idx, 1)
    row.valid = false
    // remove from row ids
    delete this.rowIds[row.rowId]
    this.activeRow = (this.activeRow >= rows.length || this.activeRow < 0) ? rows.length - 1 : this.activeRow

    var loadFlag = row.fields.__sysFields.loadFlag
    if (loadFlag === 'L' || loadFlag === 'U') {
      this.delLoadedRows.push(row)
    }
  }

  navigate (inst) {
    var prevRow = this.activeRow
    if (inst === 'next')
      this.activeRow += (this.activeRow < this.rows.length - 1) ? 1 : 0
    else if (inst === 'prev')
      this.activeRow -= (this.activeRow > 0) ? 1 : 0
    else if (inst === 'first') {
      this.activeRow = (this.rows.length > 0) ? 0 : -1
    }
    else if (inst === 'last')
      this.activeRow = this.rows.length - 1
    return prevRow !== this.activeRow
  }

  addUnresolvedLink (row, fieldDef, value) {
    this.unresolvedLinks.push({row, fieldDef, value})
  }

  findIndexedRow (key, value) {
    var idx = this.indexes[key]
    if (idx) {
      var r = idx[value]
      return (Array.isArray(r)) ? r[0] : r
    }
  }

  solveLinks () {
    for (var i = 0; i < this.unresolvedLinks.length; ++i) {
      var ul = this.unresolvedLinks[i]
      var tRow = this.dataStore.solveLink(ul.value)
      if (tRow && tRow.dataset.isOfType(ul.fieldDef.targetDSType)) {
        ul.row.link(ul.fieldDef.name, tRow, true)
        ul.row.validateField(ul.fieldDef.name)
      }
      tRow.validate()
    }
    this.unresolvedLinks = []
  }

  addRow (fieldValues, insertIndex) {
    var newRow = new Row()
    var position
    newRow.initNew(this, fieldValues)
    newRow.indexFields()
    newRow.validateAll()
    this.rowIds[newRow.rowId] = newRow
    if ((!insertIndex && insertIndex !== 0) || insertIndex < 0 || insertIndex > this.rows.length) {
      position = this.rows.push(newRow) - 1
      this.rowFields.push(newRow.fields)
    }
    else {
      for (var i = insertIndex; i < this.rows.length; ++i) {
        var pRow = this.rows[i]
        pRow.rowIndex += 1
        pRow.rowNo = pRow.rowIndex + 1
        pRow.fields.__rowIndex = pRow.rowIndex
        pRow.fields.__rowNo = pRow.rowNo
        pRow.stamp()
      }
      this.rows.splice(insertIndex, 0, newRow)
      this.rowFields.splice(insertIndex, 0, newRow.fields)
      position = insertIndex
    }
    this.activeRow = position
    newRow.rowIndex = position
    newRow.rowNo = newRow.rowIndex + 1
    newRow.fields.__rowIndex = newRow.rowIndex
    newRow.fields.__rowNo = newRow.rowNo
    return newRow
  }

  clone (modifiedRecordPos, newRecord) {
    var res = new Dataset(this.dataDef)
    Object.assign(res, this)
    if (modifiedRecordPos || modifiedRecordPos === 0) {
      if (modifiedRecordPos >= 0 && modifiedRecordPos < this.rows.length) {
        res.rows[modifiedRecordPos] = newRecord
      }
    }
  }

  getActiveRow () {
    return this.rows[this.activeRow]
  }

  goto ({rowIndex, rowId, indexField, value}) { // use either: rowIndex, rowId or (indexField and value)
    if (rowIndex || rowIndex === 0) {
      this.activeRow = (rowIndex >= 0 && rowIndex < this.rows.length) ? rowIndex : -1
    }
    else if (rowId) {
      var row = this.rowIds[rowId]
      this.activeRow = row ? row.rowIndex : -1
    }
    else if (indexField) {
      var row = this.findIndexedRow(indexField, value)
      this.activeRow = row ? row.rowIndex : -1
    }
  }

  recalcFormulas () {
    if (this.dataDef.hasFormulaField) {
      for (var i = 0; i < this.rows.length; ++i) {
        var row = this.rows[i]
        row.recalcFormulaFields()
      }
    }
  }

  reset () {
    this.rows = []
    this.rowFields = []
    this.activeRow = -1
    for (var i = 0; i < this.dataDef.indexes.length; ++i) {
      this.indexes[this.dataDef.indexes[i]] = {}
    }
  }
}

class Row {
  constructor () {
    this.fields = {__sysFields: {loadFlag: undefined}}
    this.fieldValidStates = {} // validation states
    this.fieldValidErrors = {} // validation error messages

    this.validFieldCount = 0
    this.allFieldsValid = true
    this.rowValidState = true
    this.rowValidError = ''
    this.referrers = {} // dictionary of other rows referring to this row, partitioned by datatype-linkid
  }

  init (ownerDataset) {
    this.dataset = ownerDataset
    this.dataDef = ownerDataset.dataDef
    this.typeName = this.dataDef.typeName
    this.dataStore = ownerDataset.dataStore
    this.parentRow = ownerDataset.ownerRow
    if (this.parentRow) {
      this.parentRowTypeName = this.parentRow.dataset.typeName
      this.parentRowFieldName = ownerDataset.rowFieldName
    }
    this.rowId = uuid.v4() // rowId is global and immutable
    this.fields.__rowId = this.rowId // because rowId is immutable, it is copied to fields object
    this.rowStamp = 0 // this version stamp is incremented for every change of value in this row

    this.rowIndex = -1
    this.rowNo = this.rowIndex + 1
    this.fields.__rowIndex = this.rowIndex
    this.fields.__rowNo = this.rowNo

    this.valid = true
  }

  stamp () {
    this.rowStamp += 1
    this.dataset.stamp()
  }

  setLoadFlag (loadFlag) {
    this.fields.__sysFields.loadFlag = loadFlag
    if (loadFlag === 'U' || loadFlag === 'N') {
      if (this.parentRow) {
        this.parentRow.setLoadFlag ('U')
      }
    }
  }

  initNew (ownerDataset, fieldValues) {
    this.init(ownerDataset)
    var allFieldDefs = this.dataDef.lsAllFieldDefs
    var fields = {__sysFields: {loadFlag: undefined}}
    this.fields = fields

    for(var i = 0; i < allFieldDefs.length; ++i) {
      var fieldDef = allFieldDefs[i];
      var fieldType = fieldDef.type

      if (!fieldDef.isSystem && fieldType !== 'dataset' && fieldType !== 'link') {
        if (fieldValues && (fieldDef.name in fieldValues)) {
          fields[fieldDef.name] = fieldValues[fieldDef.name]
        }
        else {
          if (fieldType === 'string')
            fields[fieldDef.name] = ''
          else if (fieldType === 'int')
            fields[fieldDef.name] = 0
          else if (fieldType === 'float')
            fields[fieldDef.name] = 0.0
          else
            fields[fieldDef.name] = undefined
        }
      }
      else if (fieldType === 'dataset') {
        var childSet = this.dataStore.createDatasetForRow(fieldDef.targetDSType, this, fieldDef.name)
        fields[fieldDef.name] = childSet
      }
      this.fieldValidStates[fieldDef.name] = true
      this.fieldValidErrors[fieldDef.name] = true
    }
    this.__setParentRow()

    this.stamp()
  }

  validateField (fieldName) {
    const fieldDef = this.dataDef.allFieldDefs[fieldName]
    const fvs = this.fieldValidStates
    const fve = this.fieldValidErrors
    if (!fieldDef)
      return
    var [isValid, errMessage] = fieldDef.validator ? fieldDef.validator(this.fields[fieldDef.name], fieldDef.name) : [true, '']
    const prevValid = fvs[fieldDef.name]
    fvs[fieldDef.name] = isValid; fve[fieldDef.name] = errMessage || ''
    if (prevValid && !isValid)
      this.validFieldCount -= 1
    else if (!prevValid && isValid)
      this.validFieldCount += 1
    this.allFieldsValid = this.validFieldCount == this.dataDef.lsAllFieldDefs.length
  }

  validateFields (elementaryFieldOnly = false) {
    const allFieldDefs = this.dataDef.lsAllFieldDefs
    const fvs = this.fieldValidStates
    const fve = this.fieldValidErrors
    this.validFieldCount = allFieldDefs.length
    for (var i = 0; i < allFieldDefs.length; ++i) {
      var fieldDef = allFieldDefs[i]
      var [isValid, errMessage] = (elementaryFieldOnly && !fieldDef.isElementaryType()) ? [true, ''] :
        (fieldDef.validator ? fieldDef.validator(this.fields[fieldDef.name], fieldDef.name) : [true, ''])
      fvs[fieldDef.name] = isValid; fve[fieldDef.name] = errMessage || ''
      if (!isValid)
        this.validFieldCount -= 1
    }
    this.allFieldsValid = this.validFieldCount == allFieldDefs.length
  }

  validate () {
    const validator = this.dataDef.rowValidator
    var [isValid, errMessage] = validator ? validator(this.fields, this) : [true, '']
    this.rowValidState = isValid
    this.rowValidError = errMessage
  }

  validateAll (elementaryFieldOnly = false) {
    this.validateFields(elementaryFieldOnly)
    this.validate()
  }

  __setLookupCheckFields () {
    for (var i = 0; i < this.dataDef.lsAllFieldDefs.length; ++i) {
      var fdef = this.dataDef.lsAllFieldDefs[i]
      if (fdef.isLookupCheckField) {
        this.fields[fdef.name] = this.fields[fdef.baseField.name]
      }
    }
  }

  __setParentRow () {
    this.fields.__parentRow = this.dataset.ownerRow
    if (this.dataDef.parentField)
      this.link(this.dataDef.parentField.name, this.dataset.ownerRow, false)
  }

  resetFieldValues () {
    var allFieldDefs = this.dataDef.lsAllFieldDefs
    var fields = this.fields

    for(var i = 0; i < allFieldDefs.length; ++i) {
      var fieldDef = allFieldDefs[i]
      var fieldType = fieldDef.type
      if (fieldDef.isElementaryType())
        fields[fieldDef.name] = undefined
      else if (fieldType === 'link')
        this.link(fieldDef.name, undefined, false)
    }
  }

  isA (dsetTypeName) {
    var cdef = this.dataDef
    while (cdef && cdef.typeName !== dsetTypeName)
      cdef = cdef.extend
    return Boolean(cdef)
  }

  initAndLoad (ownerDataset, json, dataFormat, rowFieldMapping, markLoadFlag) {
    var data, fieldMap, dsetFieldMap, arrFieldMap

    if (dataFormat === 'std')
      data = json
    else if (dataFormat === 'fmap') {
      data = json.data
      var arrFieldMap = json.arrFieldMap[this.typeName]      
      if (!arrFieldMap)
        throw Error(`array field map not found for data type ${this.typeName}`)
      if (!Array.isArray(data))
        throw Error(`Invalid row data for 'fmap' data format. Array is required`)
    }
      
    this.init(ownerDataset)
    var allFieldDefs = this.dataDef.lsAllFieldDefs

    var dsetSourceValue = [];
    Object.assign(this.fields, {__sysFields: {loadFlag: undefined}})
    var fields = this.fields

    const processData = (subdsFieldMapping) => {
      if (fieldDef.type === 'dataset') {
        if (value === undefined || value === null)
          dsetSourceValue = []
        else {
          dsetSourceValue = value
          if (!Array.isArray(dsetSourceValue))
            throw `Dataset field must be initialized with array or null. In field ${fieldDef.name} of dataset type ${this.typeName}`;
        }
        // recurse
        var childSet = this.dataStore.createDatasetForRow(fieldDef.targetDSType, this, fieldDef.name)
        fields[fieldDef.name] = childSet
        if (dataFormat === 'std') {
          childSet.load(dsetSourceValue, dataFormat, subdsFieldMapping, markLoadFlag)
        }
        else {
          childSet.load({arrFieldMap: json.arrFieldMap, data: dsetSourceValue}, dataFormat, subdsFieldMapping, markLoadFlag)
        }
      }
      else if (fieldDef.type === 'link') {
        if (value && typeof(value) === 'object') {
          this.dataset.addUnresolvedLink(this, fieldDef, value)
        }
      }
      else {
        fields[fieldDef.name] = safeConvertValue(fieldDef, value)
      }
    }

    const insertLinkTargetData = (targetDSetName, data, indexName, keyValue, linkFieldMapping) => {
      var linkDSet = this.dataStore.datasets[targetDSetName]

      var row = linkDSet.indexes[indexName][keyValue]
      if (!row) {
        var loadRowData = {[indexName]: keyValue}
        linkFieldMapping = linkFieldMapping || {}
        var trfFieldNames = Object.keys(linkFieldMapping)
        for (var i = 0; i < trfFieldNames.length; ++i) {
          var value = data[trfFieldNames[i]]
          loadRowData[linkFieldMapping[trfFieldNames[i]]] = value
        }
        linkDSet.load([loadRowData], 'std', undefined, markLoadFlag)
      }
    }
    
    if (!rowFieldMapping) {
      if (dataFormat === 'std') {
        for (var i = 0; i < allFieldDefs.length; ++i) {
          var fieldDef = allFieldDefs[i]
          var value = data[fieldDef.name]
          processData()
        }
      }
      else if (dataFormat === 'fmap') {
        for (var i = 0; i < data.length; ++i) {
          var fieldDef = allFieldDefs[arrFieldMap[i]]
          var value = data[i]
          processData()
        }
      }
    } 
    else {
      if (dataFormat === 'std') {
        var incUnmapped = rowFieldMapping.incUnmapped
        var fieldMappings = rowFieldMapping.fields
        var fieldMapping

        var dataKeys = Object.keys(data)
        for (i = 0; i < dataKeys.length; ++i) {
          var srcFieldName = dataKeys[i]
          var autoMap = false

          if (srcFieldName in fieldMappings)  {
            fieldMapping = fieldMappings[srcFieldName]
          }
          else {
            if (!incUnmapped) {
              continue // ignore unmapped fields
            }
            else {
              fieldMapping = {mapType: 'field', targetField: srcFieldName}
              autoMap = true
            }
          }
          if (fieldMapping === undefined) {
            continue // ignore void mapping
          }

          var mapType = fieldMapping.mapType
          var targetFieldName = mapType === 'field' ? fieldMapping.targetField : 
                                  mapType === 'dataset' ? fieldMapping.dsetField :
                                    mapType === 'link' ? fieldMapping.link : undefined

          var fieldDef = this.dataDef.allFieldDefs[targetFieldName]

          if (!fieldDef) {
            if (!autoMap) {
              console.warn(`Cannot find mapping target "${targetFieldName}" in dataset of type ${this.typeName} while loading data`)
            }
            continue // skip when target field not found
          }
          
          if (mapType === 'field' || mapType === 'dataset') {
            var value = data[srcFieldName]
            processData(fieldMapping.fieldMapping)
          }
          else if (mapType === 'link') {
            var keyValue = data[srcFieldName]
            var value = {dset: fieldMapping.dset, [fieldMapping.index]: keyValue}
            processData()
            insertLinkTargetData(fieldMapping.dset, data, fieldMapping.index, keyValue, fieldMapping.fieldMapping)
          }
        } // for dataKeys
      }
      else {
        throw Error('Field mapping is only supported for "std" data format')
      }
    }

    if (markLoadFlag) {
      this.setLoadFlag('L')
    }
    this.__setLookupCheckFields()
    this.__setParentRow()
  }

  unload (dataFormat, rfmFields, options) {
    var fieldMapping
    var targetFieldNames

    var result = {}

    targetFieldNames = Object.keys(rfmFields)

    for (var i = 0; i < targetFieldNames.length; ++i) {
      var targetFieldName = targetFieldNames[i]
      var fieldMapping = rfmFields[targetFieldName]
      var srcFieldName = fieldMapping.srcField
      var fieldDef = this.dataDef.allFieldDefs[srcFieldName]
      if (!fieldDef)
        continue

      var value = this.fields[srcFieldName]
      switch (fieldMapping.mapType) {
        case 'field':
          result[targetFieldName] = fieldDef.type == 'date' ? dateValueToStr(value, 'dt') : fieldDef.asString(value)
          break
        case 'link':
          result[targetFieldName] = value && value.fields && value.fields[fieldMapping.index]
          break
        case 'dataset':
          if (value) {
            result[targetFieldName] = value.unload(dataFormat, fieldMapping.fieldMapping, options)
          }
          else {
            result[targetFieldName] = []
          }
          break          
      }
    }
    return result
  }

  indexFields (fieldNames) {
    var indexes = this.dataDef.indexes
    if (!fieldNames) {
      for (var i = 0; i < indexes.length; ++i) {
        var fval = this.fields[indexes[i]]
        this.dataset.indexRow(indexes[i], fval, this)
      }
    }
    else {
      for (var i = 0; i < fieldNames.length; ++i) {
        var fieldName = fieldNames[i]
        if (fieldName in this.dataset.indexes)
          this.dataset.indexRow(fieldName, this.fields[fieldName], this)
      }
    }
  }

  removeIndexFields () {
    var indexes = this.dataDef.indexes
    for (var i = 0; i < indexes.length; ++i) {
      var fval = this.fields[indexes[i]]
      this.dataset.removeIndexRow(indexes[i], fval, this)
    }
  }

  recalcFormulaFields (setField = true, fieldValues) {
    var dataDef = this.dataDef
    var fieldNames = fieldValues ? Object.keys(fieldValues) : undefined
    fieldValues = fieldValues || {}
    var fieldFormulas = !fieldNames ? dataDef.fieldWithFormulas :
      fieldNames.map((fieldName) => dataDef.allFieldDefs[fieldName])
    var fields = setField ? this.fields : {}
    var row = this

    for (var i = 0; i < fieldFormulas.length; ++i) {
      var fieldDef = fieldFormulas[i]
      fields[fieldDef.name] = fieldValues[fieldDef.name] === undefined ? eval(fieldDef.rtFormula) : fieldValues[fieldDef.name]
    }

    if (setField) {
      var datasetFields = dataDef.datasetFields
      for (var i = 0; i < datasetFields.length; ++i) {
        var fieldDef = datasetFields[i]
        var subds = fields[fieldDef.name]
        if (subds)
          subds.recalcFormulas()
      }
      this.indexFields(fieldNames)
    }
    return fields
  }

  link (fname, targetRow, solvingMode = false) {
    var prevTargetRow

    if (!solvingMode) {
      prevTargetRow = this.fields[fname]
      if (prevTargetRow && prevTargetRow !== targetRow)
        prevTargetRow.unrefer(fname, this)
    }
    if (targetRow && prevTargetRow !== targetRow)
      targetRow.refer(fname, this)

    this.fields[fname] = targetRow
  }

  refer (fname, referringRow) {
    var keyName = referringRow.typeName + '|' + fname
    if (!(keyName in this.referrers))
      this.referrers[keyName] = {}
    this.referrers[keyName][referringRow.rowId] = referringRow
  }

  unrefer (fname, referringRow) {
    var keyName = referringRow.typeName + '|' + fname
    delete this.referrers[keyName][referringRow.rowId]
  }

  cleanUp () { // before-delete actions
    // remove indexed fields
    this.removeIndexFields()

    // set referrer rows to undefined
    for (var refKey in this.referrers) {
      var refRows  = this.referrers[refKey]
      var fName = refKey.split('|')[1] 
      for (var refRowId in refRows) {
        var row = refRows[refRowId]
        row.link(fName, undefined, true)
      }
    }
    this.referrers = {}
  }

  clone (sModifiedField, newValue) {
    var result = new Row()
    Object.assign(result, this)
    if (sModifiedField)
      result.fields[sModifiedField] = newValue
    return result
  }

  getField (fieldName) {
    return this.fields[fieldName]
  }

  getLink (fieldName, targetFieldName) {
    var referredRow = this.fields[fieldName]
    if (referredRow && referredRow instanceof Row) {
      return referredRow.fields[targetFieldName]
    }
    else
      return null
  }

  getAggr (aggrfname, fieldName, targetFieldName) {
    var dset = this.fields[fieldName]
    if (dset) {
      if (aggrfname === 'min') {
        var m = dset.rows.length > 0 ? dset.rows[0].fields[targetFieldName] : null
        for (var j = 1; j < dset.rows.length; ++j) {
          if (dset.rows[j].fields[targetFieldName] < m)
            m = dset.rows[j].fields[targetFieldName]
        }
        return m
      }
      else if (aggrfname === 'max') {
        var m = dset.rows.length > 0 ? dset.rows[0].fields[targetFieldName] : null
        for (var j = 1; j < dset.rows.length; ++j) {
          if (dset.rows[j].fields[targetFieldName] > m)
            m = dset.rows[j].fields[targetFieldName]
        }
        return m
      }
      else if (aggrfname === 'sum') {
        m = 0
        for (var j = 0; j < dset.rows.length; ++j) {
          var v = dset.rows[j].fields[targetFieldName]
          m += (typeof(v) === 'number' ? v : 0)
        }
        return m
      }
      else if (aggrfname === 'avg') {
        m = 0
        for (var j = 0; j < dset.rows.length; ++j) {
          var v = dset.rows[j].fields[targetFieldName]
          m += (typeof(v) === 'number' ? v : 0)
        }
        return dset.rows.length > 0 ? m / dset.rows.length : null
      }
      else if (aggrfname === 'count') {
        return dset.rows.length
      }

    }
  }


}

class FVar { // formula variable
  constructor (fdTarget, fdSource, symbol, relationshipType, contextTypeName) { 
    /* 
      fdTarget: FieldDef object (formula target, formula owner), fdSource: FieldDef object (field value source)
      symbol: symbol name
      relationshipType: 'this', 'link' or 'sub'
      contextTypeName: parent data set type name if relationshipType === 'sub'
    */
    this.target = fdTarget
    this.source = fdSource
    this.contextTypeName = contextTypeName
    this.symbol = symbol
    this.relType = relationshipType
  }

  getRecalcTargets (row) {
    if (this.relType === 'this')
      return [{row, fieldName: this.target.name}]
    else if (this.relType === 'link') {
      var result =  []
      var refRows = row.referrers[this.target.dsTypeName + '|' + this.symbol]
      if (refRows) {
        for (var rowId in refRows)
          result.push({row: refRows[rowId], fieldName: this.target.name})
      }
      return result
    }
    else if (this.relType === 'sub') {
      return row.parentRow ? [{row: row.parentRow, fieldName: this.target.name}] : []
    }
  }

  getStrRepTarget () {
    if (this.relType === 'this')
      return 'this.' + this.symbol
    else if (this.relType === 'link' || this.relType === 'sub')
      return 'this.' + this.symbol + '.' + this.source.name
  }

  getStrRepSrc () {
    if (this.relType === 'this')
      return 'this.' + this.target.name
    else if (this.relType === 'link') {
      return 'this.referrers["' + this.target.dsTypeName + '|' + this.symbol + '"].' + this.target.name 
    }
    else if (this.relType === 'sub') 
      return 'this.__parentRow.' + this.target.name
  }
}

export {Metadata, DataStore}

