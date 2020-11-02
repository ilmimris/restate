import {Metadata, DataStore} from './jsdset.js'

import React from 'react';
import { ContextProviderHook, ContextConnector, renderActionObject } from './appcontext.js';

function createDatasetVars(initMetadata, initData, uiData = {}) {
  var md = new Metadata(uiData)
  try {
    md.load(initMetadata)
  } catch (error) {
    console.error(error.message)
    throw error;
  }

  var store = new DataStore(md)
  try {
    store.load(initData)
  } catch (error) {
    console.error(error.message)
    throw error;
  }

  if (typeof(uiData) !== 'object') {
    throw Error('uiData must be object')
  }

  return {md, store, uiData, stamp: 0}
}

var datasetActions = {
  setField: (vars, {rowPath, fieldName, value, deferFormula}) => {
    vars.store.update([
      {
        inst: 'set',
        row: rowPath,
        values: {[fieldName]: value},
      }
    ], {deferFormula}, vars.stamp)
    return {...vars, stamp: vars.stamp + 1}
  },

  setFields: (vars, {rowPath, values, deferFormula}) => {
    vars.store.update([
      {
        inst: 'set',
        row: rowPath,
        values: values,
      }
    ], {deferFormula}, vars.stamp)
    return {...vars, stamp: vars.stamp + 1}
  },
  
  addRow: (vars, {containerRowPath, dsetPath, values, beforeIndex, deferFormula}) => {
    // console.log(`addRow() invoked. stamp: ${vars.stamp}`)
    vars.store.update([
      {
        inst: 'add',
        row: containerRowPath,
        dset: dsetPath,
        values: values,
        before_row: beforeIndex
      }
    ], {deferFormula}, vars.stamp)
    return {...vars, stamp: vars.stamp + 1}
  },

  deleteRow: (vars, {rowPath, deferFormula}) => {
    vars.store.update([
      {
        inst: 'del',
        row: rowPath
      }
    ], {deferFormula}, vars.stamp)
    return {...vars, stamp: vars.stamp + 1}
  },

  clear: (vars, {containerRowPath, dsetPath, deferFormula}) => {
    vars.store.update([
      {
        inst: 'clear',
        owner_row: containerRowPath,
        dset: dsetPath
      }
    ], {deferFormula}, vars.stamp)
    return {...vars, stamp: vars.stamp + 1}
  },

  nav: (vars, {inst, containerRowPath, dsetPath}) => {
    // console.log(`navigation invoked ${inst} @${dsetPath} stamp: ${vars.stamp}`)
    if (vars.store.navigate(inst, containerRowPath, dsetPath, vars.stamp))
      return {...vars, stamp: vars.stamp + 1}
  }, 

  goto: (vars, {dsetPath, rowIndex, rowId, indexField, value}) => {
    if (vars.store.goto(dsetPath, rowIndex, rowId, indexField, value, vars.stamp))
      return {...vars, stamp: vars.stamp + 1}
  },

  load: (vars, {dsetPath, json, dataFormat, markLoadFlag}) => {
    if (vars.store.loadDataset(dsetPath, json, dataFormat, markLoadFlag, vars.stamp))
      return {...vars, stamp: vars.stamp + 1}
  },

  recalcFormulas: (vars) => {
    vars.store.recalcFormulas()
    return {...vars, stamp: vars.stamp + 1}
  },

  resetStore: (vars, ) => {
    vars.store.reset(vars.stamp)
    return {...vars, stamp: vars.stamp + 1}
  },

  loadStore: (vars, {json, dataFormat, dataMapping, markLoadFlag}) => {
    vars.store.load(json, dataFormat, dataMapping, markLoadFlag, vars.stamp)
    return {...vars, stamp: vars.stamp + 1}
  }
}

const EMPTY_OBJECT = {}
const EMPTY_ARRAY = []

const metaMapVarsToProps = (dsetPath, allRows = false) => (vars, ownProps) => {
  
  var store = vars ? vars.store : undefined
  var ds = store ? store.findDataset(dsetPath) : undefined

  if (!ds) {
    return {
      dsetPath: dsetPath,
      fieldDefs: EMPTY_OBJECT,
      stamp: undefined,
      fields: EMPTY_OBJECT,
      fieldsArray: EMPTY_ARRAY,
      fieldValidStates: EMPTY_OBJECT,
      fieldValidErrors: EMPTY_OBJECT,
      rowValidState: true,
      rowValidError: ''
    }
  }

  if (!allRows) {
    var activeRow = ds ? ds.getActiveRow() : undefined
    return {
      dsetPath: dsetPath, 
      fieldDefs: ds ? ds.dataDef.allFieldDefs : EMPTY_OBJECT,
      stamp: activeRow ? activeRow.rowStamp : undefined,
      fields: activeRow ? activeRow.fields : EMPTY_OBJECT,
      fieldValidStates: activeRow ? activeRow.fieldValidStates : EMPTY_OBJECT,
      fieldValidErrors: activeRow ? activeRow.fieldValidErrors : EMPTY_OBJECT,
      rowValidState: activeRow ? activeRow.rowValidState : true,
      rowValidError: activeRow ? activeRow.rowValidError : '',
      uiData: vars.uiData ? (vars.uiData[ds.typeName] || {}) : {},
    }
  }
  else {
    return {
      dsetPath: dsetPath, 
      fieldDefs: ds ? ds.dataDef.allFieldDefs : EMPTY_OBJECT,
      stamp: ds ? ds.rowsStamp : undefined,
      fieldsArray: ds ? ds.rowFields : EMPTY_ARRAY,
      uiData: vars.uiData ? (vars.uiData[ds.typeName] || {}) : {},
    }
  }
}

const metaMapDispatchToProps = (dsetPath) => (disp) => ({
    setField: (fieldName, value, deferFormula = false) => disp({type: 'setField', rowPath: dsetPath, fieldName, value, deferFormula}),
    setFields: (fieldNameValues, deferFormula = false) => disp({type: 'setFields', rowPath: dsetPath, values: fieldNameValues, deferFormula}),
    next: () => disp({type: 'nav', inst: 'next', dsetPath}),
    prev: () => disp({type: 'nav', inst: 'prev', dsetPath}),
    first: () => disp({type: 'nav', inst: 'first', dsetPath}),
    last: () => disp({type: 'nav', inst: 'last', dsetPath}),
    addRow: (values, beforeIndex, deferFormula = false) => disp({type: 'addRow', dsetPath, values, beforeIndex, deferFormula}),
    deleteRow: (rowId, deferFormula = false) => disp({type: 'deleteRow', rowPath: {dset: dsetPath, row: rowId, deferFormula}}),
    clear: () => disp({type: 'clear', dset: dsetPath}),
    goto: ({rowIndex, rowId, fieldIndex, value}) => disp({type: 'goto', dsetPath, rowIndex, rowId, fieldIndex, value}),
    load: (json, dataFormat, markLoadFlag) => disp({type: 'load', dsetPath, json, dataFormat, markLoadFlag}),
    recalcFormulas: () => disp({type: 'recalcFormulas'}),
    resetStore: () => disp({type: 'resetStore', }),
    loadStore: (json, dataFormat, dataMapping = {}, markLoadFlag) => disp({type: 'loadStore', json, dataFormat, dataMapping, markLoadFlag})
  }
)

const dsetCreateContext = () => React.createContext({})
const dsetMetaProvider = (context, metadata, initData, uiData) => {
  var vars = createDatasetVars(metadata, initData, uiData)
  const ProviderComponent = ContextProviderHook(context, datasetActions, vars)
  ProviderComponent.dataContext = context
  return ProviderComponent
}
const dsetMetaProviderEx = (context, metadata, initData, uiData) => {
  var vars = createDatasetVars(metadata, initData, uiData)
  const ProviderComponent = ContextProviderHook(context, datasetActions, vars)
  ProviderComponent.dataContext = context
  return [ProviderComponent, vars.store]
} 

const dsetMetaConnector = (context, dataPath, allRows = false) => ContextConnector(context, 
  metaMapVarsToProps(dataPath, allRows),
  metaMapDispatchToProps(dataPath),
)

function connectComponents({context, dsetPath, allRows}, comps) {

  var connector = dsetMetaConnector(context, dsetPath, allRows)
  return Object.fromEntries(Object.entries(comps).map(
    ([key, comp]) => [key, connector(comp)] 
  ))
  // return [{}].concat(Object.entries(comps).map(
  //     (k_c) => [k_c[0], connection(k_c[1])] 
  //   )).reduce(
  //     (v, k_cc) => ({
  //         ...v, 
  //         [k_cc[0]]: k_cc[1] 
  //     })
  //   )
}

const connect = connectComponents

class DSetAction extends React.PureComponent { // existing ...Action style helper object
  // required props:
  // context: (object returned from dsetCreateContext)
  // dsetPath: (string)
  // multiRow: (boolean)

  render () {
    return renderActionObject(this.props.context, this, 
      (state) => {
        const mapper = metaMapVarsToProps(this.props.dsetPath, this.props.multiRow)
        const mp = mapper(state)
        this.dataStore = state.store
        this.dsetPath = this.props.dsetPath 
        this.fieldDefs = mp.fieldDefs
        this.rowStamp = mp.stamp
        this.fields = mp.fields || {}
        this.fieldsArray = mp.fieldsArray || []
        this.fieldValidStates = mp.fieldValidStates || {}
        this.fieldValidErrors = mp.fieldValidErrors || {}
        this.rowValidState = mp.rowValidState
        this.rowValidError = mp.rowValidError || ''
      }
    )
  }

  setField (fieldName, value, deferFormula = false) { this.disp({type: 'setField', rowPath: this.props.dsetPath, fieldName, value, deferFormula}) }
  setFields (fieldNameValues, deferFormula = false) { this.disp({type: 'setFields', rowPath: this.props.dsetPath, values: fieldNameValues, deferFormula}) }
  next () { this.disp({type: 'nav', inst: 'next', dsetPath: this.props.dsetPath}) }
  prev () { this.disp({type: 'nav', inst: 'prev', dsetPath: this.props.dsetPath}) }
  first () { this.disp({type: 'nav', inst: 'first', dsetPath: this.props.dsetPath}) }
  last () { this.disp({type: 'nav', inst: 'last', dsetPath: this.props.dsetPath}) }
  addRow (values, beforeIndex, deferFormula = false) { this.disp({type: 'addRow', dsetPath: this.props.dsetPath, values, beforeIndex, deferFormula}) }
  deleteRow (rowId, deferFormula = false) { 
    console.log(`delete rowId = ${rowId}`)
    this.disp({type: 'deleteRow', rowPath: {dset: this.props.dsetPath, row: rowId, deferFormula}}) 
  }
  clear () { this.disp({type: 'clear', dset: this.props.dsetPath}) }
  goto ({rowIndex, rowId, fieldIndex, value}) { this.disp({type: 'goto', rowIndex, rowId, fieldIndex, value}) }
  load (json, dataFormat, markLoadFlag) { this.disp({type: 'load', dsetPath: this.props.dsetPath, json, dataFormat, markLoadFlag}) }
  recalcFormulas () { this.disp({type: 'recalcFormulas'}) }
  resetStore () { this.disp({type: 'resetStore', }) }
  loadStore (json, dataFormat, dataMapping = {}, markLoadFlag) { this.disp({type: 'loadStore', json, dataFormat, dataMapping, markLoadFlag}) }
  unloadStore (dataMapping, includeLoadedRows = false, includeDeletedRows = false) { 
    return this.dataStore.unload('std', dataMapping, {includeLoadedRows, includeDeletedRows})
  }
}

export {dsetCreateContext, dsetMetaProvider, dsetMetaProviderEx, dsetMetaConnector, connect, connectComponents, DSetAction}
