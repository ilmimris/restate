import React from 'react';

function createReducer(actionHandlers) {
  return (state, action) => {
    var ae = actionHandlers[action.type]
    if (!ae)
      throw Error(`Unknown action type ${action.type}`)
    var newState = typeof(ae) == 'function' ? ae(state, action) : ae.handler(state, action)
    return newState || state
  }
}

function createMethods(actionHandlers) {

  var actMethods = {}
  var handler

  // console.log('createActionMethods() called')
  for (let mn in actionHandlers) {
    var action = actionHandlers[mn]
    if (typeof(action) == 'function') {
      actMethods[mn] = (...args) => {
        return {type: mn, ...(args[0] || {})}
      }
    }
    else {
      handler = action.handler
      if (!handler)
        throw Error(`No handler is specified in action handler for action type ${mn}`)
      let argMapper = action.argMap ? action.argMap : ((args) => (args[0]))
      actMethods[mn] = (...args) => {
        return {type: mn, ...(argMapper(args) || {})}
      }
    }
  }
  return actMethods
}

function ContextProviderHook(context, actionHandlers, initState) {

  function ProviderComponent(props) {
    const initialState = React.useMemo(
      () => {
        var initVars, nextVars
        // console.log('initial state calculated -- should be once')
        if (props.initActions && Array.isArray(props.initActions)) {
          initVars = initState;
          for (var i = 0; i < props.initActions.length; ++i) {
            var initAction = props.initActions[i];
            if (!Array.isArray(initAction) || initAction.length === 0)
              throw new Error('each member of initActions must be array');
            var actionName = initAction[0];
            var action = actionHandlers[actionName];
            if (typeof(action) == 'function')
              nextVars = action.call(null, initVars, initAction[1])
            else if (typeof(action.handler) == 'function')
              nextVars = action.handler.call(null, initVars, initAction[1])
            else
              throw new Error(`initActions: Action "${actionName}" is not defined`);
            
            initVars = nextVars || initVars; 
          }
        }
        else
          initVars = initState;
        return initVars
      },
      [props.initActions]
    )
  
    const [state, dispatch] = React.useReducer(createReducer(actionHandlers), initialState)
    if (props.refDispatch && typeof(props.refDispatch) == 'function')
      props.refDispatch(dispatch, methods)
    return (
      <context.Provider value={{state, dispatch, methods}}>
        {props.children}
      </context.Provider>
    )
  }

  var methods = createMethods(actionHandlers)

  return ProviderComponent
}

function ContextConnector(context, stateFilter, dispatchPropsCreator, mixPropsCreator, dispatchPropName, methodsPropName) {
  function injectComponent(Component) {
    function ConnectedComponent(props) {
      const {state, dispatch, methods} = React.useContext(context)

      const stateProps = stateFilter ? stateFilter(state, props) : state
      dispatchPropsCreator = dispatchPropsCreator || (() => ({}))
      const dispatchProps = React.useMemo(() => dispatchPropsCreator(dispatch, methods), [dispatch, methods])
      const mixProps = mixPropsCreator ? mixPropsCreator(stateProps, dispatchProps) : {} // mixProps are not cached, since they may depend on state value

      return (
        <Component {...stateProps} {...dispatchProps} {...mixProps} {...{[dispatchPropName || 'disp']: dispatch, [methodsPropName || 'meth']: methods}} {...props}>
          {props.children}
        </Component>
      )
    }
    return ConnectedComponent
  }

  return injectComponent
}

function renderActionObject(context, actionInstance, statePropMaps) {
  return (<context.Consumer> 
    {
      ({state, dispatch, methods}) => {
        actionInstance.dispatch = dispatch
        actionInstance.methods = methods      
        actionInstance.disp = dispatch
        actionInstance.meth = methods
        statePropMaps = statePropMaps || {}
        if (typeof(statePropMaps) == 'object') {
          var targetNames = Object.keys(statePropMaps)
          for (var targetName in targetNames) {
            actionInstance[targetName] = state[targetNames[targetName]]
          }
        }
        else if (typeof(statePropMaps) == 'function') {
          statePropMaps(state, actionInstance)
        }
        return <></>
      }
    }
  </context.Consumer>)
}

// simple function to yield event loop so the actions after await will be executed in the next event loop
// usage example:
// await yieldEventLoop()
// console.log('do something')

async function yieldEventLoop() {
  return new Promise(
      (resolve) => {
        setTimeout(() => resolve(), 0)
      }
    )
}

export { ContextProviderHook, ContextConnector, renderActionObject, yieldEventLoop }

/* 
actionHandlers example (with argMap)

const initialState = {f1: 'abc', f2: 'def', f3: 'ghi', f4: 'jkl', counter: 0}
const actionHandlers = { 
  setField: {
    handler: (state, params) => {
      var fName = params.fieldName
      if (!fName)
        throw Error('Invalid field name')
      return {...state, [fName]: params.value}
    },
    argMap: ([fieldName, value]) => ({fieldName, value})
  },
  increment: {
    handler: (state, params) => {
      return {...state, counter: state.counter + (params.step || 0)}
    },
    argMap: ([step]) => ({step})
  }
}
*/
