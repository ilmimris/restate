/*
  dsetwidget.js
  Visual components that are linked to dataset object
  Use in conjunction with jsdsetconnect.js
*/

import React from 'react';

const PanelDataDisplay = (p) => {
  var vals = p.fields;
  var fieldDefs = p.fieldDefs;
  var selFieldNames = p.selFields
  var delFieldNames = p.delFields

  var inclFieldNames = Object.keys(fieldDefs)
  if (selFieldNames && Array.isArray(selFieldNames)) {
    inclFieldNames = inclFieldNames.filter((name) => (selFieldNames.indexOf(name) >= 0))
  }

  if (delFieldNames && Array.isArray(delFieldNames)) {
    inclFieldNames = inclFieldNames.filter((name) => (delFieldNames.indexOf(name) < 0))
  }

  fieldDefs = inclFieldNames.map((name) => fieldDefs[name]).filter(fd => (!fd.isSystem || selFieldNames && selFieldNames.indexOf(fd.name) >= 0))

  return (
    <div>
    {
      Object.keys(fieldDefs).map((k) => 
        {
          var fd = fieldDefs[k]
          var result = (fd && fd.type != 'dataset' && fd.type != 'link') ? 
            (<span key={fd.name}><br /><b>{fd.title ? fd.title : fd.name}</b>: {fd.asString(vals[fd.name])}</span>) :
            (<span key={fd.name}></span>)
          return result
        }
      )
    }
    </div>
  )
}

const FieldDataDisplay = (p) => {
  var fieldName = p.fieldName
  var fd = p.fieldDefs[fieldName]
  if (!fd) {
    console.log(`Field ${fieldName} not found`)
  }
  return (
    <span>{(p.fields === undefined) ? '' : fd ? fd.asString(p.fields[fieldName]) : `FIELD ${fieldName} NOT FOUND`}</span>
  )
}

class GridDataRow extends React.Component {

  state = {selected: false}

  onMouseOver = () => {
    // console.log('mouse over')
    this.setState({...this.state, selected: true});
    this.props.hidePopup(this.props.row)
  }

  onMouseOut = () => {
    // console.log('mouse out')
    this.setState({...this.state, selected: false});
  }

  onClick = (e) => {
    console.log(`Row ${this.props.rowId} clicked`)
    e.stopPropagation()
    this.props.gridProps.goto({rowId: this.props.rowId})
    if (this.props.onRowClick && typeof(this.props.onRowClick) == 'function') {
      this.props.onRowClick(this.props.row, this.props)
    }
  }

  onContextMenu = (e) => {
    e.preventDefault()
    // console.log(`context menu ${e.clientX}, ${e.clientY}`)
    this.props.setPopup(e.clientX, e.clientY, this.props.row)
    return false
  }

  onDeleteClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    this.props.deleteRow(e.target.id);
  }

  render() {
    const props = this.props
    return (
      <tr key={props.rowId} onMouseOver={this.onMouseOver} onMouseOut={this.onMouseOut} onClick={this.onClick}
      onContextMenu={this.onContextMenu}
      style={{backgroundColor: this.state.selected ? "#dddddd": "#ffffff"}}>
      {
        (
          props.cells.map((cell, index) => 
            <td key={cell.key} align={(index == props.cells.length - 1 && !props.hideDeleteButton) ? "right" : "left"}>
              {props.fieldDefs[index].asString(cell.value)}
              {
                index == props.cells.length - 1 ? 
                  <span>
                    &nbsp;&nbsp;
                    {
                      props.hideDeleteButton ? 
                      <></> :
                      <
                        button key={cell.key} style={{visibility: this.state.selected ? "visible" : "hidden"}}
                        onClick={this.onDeleteClick} id={props.rowId}
                      >
                      delete
                      </button>
                    }
                  </span> 
                  : 
                  <span>&nbsp;</span>
              }
            </td>
          )
        )
      }
      </tr>
    );
  }
};

const GridDataDisplay = (p) => {
  const selectedFields = p.selFields
  const deletedFields = p.delFields
  const columns = p.columns || {} // columns are object with field names as keys

  var fieldDefs = Object.keys(p.fieldDefs).map(k => p.fieldDefs[k])
  var fieldDefs = fieldDefs.filter(f => (f.type !== 'dataset' && f.type !== 'link'))
  var rows = p.fieldsArray
  const [state, setState] = React.useState({popupShown: false, popupX: 0, popupY: 0, popupRow: undefined})
  const setPopup = React.useCallback((x, y, row) => setState({popupShown: true, popupX: x, popupY: y, popupRow: row}), [setState])
  const hidePopup = React.useCallback(
    (row) => {
      if (row !== state.popupRow || row === null)
        setState({popupShown: false})
    }, [setState])

  if (selectedFields && Array.isArray(selectedFields)) {
    fieldDefs = fieldDefs.filter(f => selectedFields.indexOf(f.name) >= 0)
  }

  if (deletedFields && Array.isArray(deletedFields)) {
    fieldDefs = fieldDefs.filter(f => deletedFields.indexOf(f.name) < 0)
  }

  fieldDefs = fieldDefs.filter(f => !f.isSystem || (selectedFields && selectedFields.indexOf(f.name) >= 0))

  return (
    <div>
      <table className="ui celled table">
        <thead>
        {
          !p.hideColumnTitles ?
            <tr>
            {
              fieldDefs.map(f => (
                <th key={f.name}>
                  <b>
                    {columns[f.name] && columns[f.name].title ? columns[f.name].title : f.title ? f.title : f.name}
                  </b>
                </th>))
            }
          </tr> : <></>
        }
        </thead>
        <tbody>
          {
            rows.map((row, index) => (
                <GridDataRow 
                  key={row.__rowId}
                  rowId={row.__rowId}
                  row={row}
                  deleteRow={p.deleteRow}
                  cells={
                    fieldDefs.map((f, index) => ({key: index, value: row[f.name]}))
                  }
                  fieldDefs={fieldDefs}
                  hideDeleteButton={p.hideDeleteButton}
                  onRowClick={p.onRowClick}
                  setPopup={setPopup}
                  hidePopup={hidePopup}
                  gridProps={p}
                />
              )
            )
          }
        </tbody>
      </table>
      {
        (state.popupShown && p.popupComponent) ?
          <div style={
              {
                position: "absolute", 
                left: state.popupX + "px", 
                top: state.popupY + "px", 
                width: p.popupWidth || "200px",
                // height: p.popupWidth || "300px",
                backgroundColor: "Window",
                // borderStyle: "solid",
                // borderColor: "lightgray",
                // borderWidth: "1px",
                // padding: "-10px",
              }
            }
            onMouseLeave={() => {hidePopup(null)}}
          >
            <p.popupComponent currentRow={state.popupRow} />
          </div> : <></>
      }

    </div>
  )
};

class FieldDataInput extends React.Component {

  constructor (props) {
    super(props)
    const uidField = (props.uiData && props.uiData.fields ? this.props.uiData.fields[props.fieldName] : {}) || {}
    this.uidField = uidField
    const lookup = (uidField.lookup && typeof(uidField.lookup) === 'object') ? uidField.lookup : {}
    this.lookup = lookup
    const lookupStyle = lookup.style || {}
    this.lookupStyle = lookupStyle
    if (props.dataSelector && (typeof(props.dataSelector) !== 'function'))
      throw Error('Data selector must be async function')
    if (props.dataValidator && (typeof(props.dataValidator) !== 'function'))
      throw Error('Data validator must be async function')
    this.dataSelector = props.dataSelector || (props.appAction && this.defaultDataSelector)
    this.dataValidator = props.dataValidator || (props.appAction && this.defaultDataValidator)
  }

  defaultDataSelector () {

  }

  defaultDataValidator () {

  }

  onChange = (e) => {
    const fieldName = this.props.fieldName;
    this.props.setField(fieldName, e.target.value);
  }

  onExit = (e) => {
    const fieldName = this.props.fieldName
    const checkFieldName = '__chk_' + fieldName

    if (this.uidField.lookup && this.lookupStyle.input && this.dataValidator) { //  validate this field if lookup-input field
      const lookup = this.lookup
      const fields = this.props.fields

      if ((checkFieldName in fields) && fields[fieldName] !== fields[checkFieldName]) {
        var selectPromise = this.dataValidator(
          lookup.api,
          lookup.fields,
          lookup.keyField,
          lookup.sortFields,
          (lookup.apiParameterF && typeof(lookup.apiParameterF) === 'function') ? lookup.apiParameterF(this.props.fields, true) : {},
          this.props.validatorSettings || {}
        )
        if (!selectPromise.constructor || selectPromise.constructor.name !== 'Promise')
          throw Error('dataSelector must be async function')

        selectPromise.then(
          (result) => {
            if (result && lookup.fieldMap && typeof(lookup.fieldMap) === 'object') {
              var fieldSettings = Object.fromEntries(Object.keys(lookup.fieldMap).map(k => [k, result[lookup.fieldMap[k]]]))
              fieldSettings['__chk_' + fieldName] = fieldSettings[fieldName]
              this.props.setFields(fieldSettings)
            }
            else if (result === null) {
              if (this.props.onInvalidData && typeof(this.props.onInvalidData) === 'function' ) {
                const pr = this.props.onInvalidData(fieldName)
                if (pr.constructor && pr.constructor.name === 'Promise') {
                  pr.then(() => {})
                }
              }
              //
            }
          }
        )
      }
    }
  }

  onLookupClick = async (e) => {
    if (this.dataSelector) {
      const lookup = this.lookup
      var selectPromise = this.dataSelector(
        lookup.api,
        lookup.fields,
        lookup.keyField,
        lookup.sortFields,
        (lookup.apiParameterF && typeof(lookup.apiParameterF) === 'function') ? lookup.apiParameterF(this.props.fields, false) : {},
        this.props.selectorSettings || {}
      )
      if (!selectPromise.constructor || selectPromise.constructor.name !== 'Promise')
        throw Error('dataSelector must be async function')
      selectPromise.then(
        (result) => {
          if (result && lookup.fieldMap && typeof(lookup.fieldMap) === 'object') {
            var fieldSettings = Object.fromEntries(Object.keys(lookup.fieldMap).map(k => [k, result[lookup.fieldMap[k]]]))
            this.props.setFields(fieldSettings)
          }    
        }
      )
    }
  }

  render() {
    const props = this.props
    const fieldName = props.fieldName
    const vals = props.fields
    const fd = props.fieldDefs[fieldName]
    const elProps = props.elProps ? props.elProps : {}
    const lookupStyle = this.lookupStyle

    // if (this.uidField.lookup)
    //   console.log(lookupStyle)
    if (!fd)
      console.log(`FieldDataInput: field ${fieldName} not found`)

    return (
      <>
        <input value={fd ? (fd.asString(vals[fieldName]) || '') : ''} 
          {...elProps} 
          onChange={this.onChange}
          onBlur={this.onExit}
          {...({readOnly: this.uidField.lookup && !lookupStyle.input, maxLength: fd ? fd.length : undefined})}
        />
        {
          (lookupStyle.button && this.dataSelector)? <button onClick={this.onLookupClick}>...</button> :
            <></>
        }
      </>
      
    )
  }
};

class PanelButton extends React.Component {

  onClick = (e) => {
    if (this.props.navType == 'next')
      this.props.next()
    else if (this.props.navType == 'prev')
      this.props.prev()
    else if (this.props.navType == 'first')
      this.props.first()
    else if (this.props.navType == 'last')
      this.props.last()
    else if (this.props.navType == 'new')
      this.props.addRow({})
  }

  render() {
    return (
      <button onClick={this.onClick}>{this.props.caption}</button>
    );
  }

};

export {PanelDataDisplay, FieldDataDisplay, GridDataDisplay, FieldDataInput, PanelButton};