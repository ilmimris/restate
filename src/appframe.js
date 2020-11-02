import React from 'react';
import { ContextProviderHook, ContextConnector, renderActionObject } from './appcontext.js';
import { Modal } from 'semantic-ui-react';

var AppFrameContext = React.createContext({});

const DEFAULT_POPUP_WIDTH = '400px'
const DEFAULT_POPUP_HEIGHT = '300px'
const DEFAULT_POPUP_LEFT = '100px'
const DEFAULT_POPUP_TOP = '200px'

class PageInstance {
  constructor (instanceName, className, classRegister, title) {
    this.instanceName = instanceName
    this.title = title
    this.className = className
    this.classRegister = classRegister
    this.componentClass = classRegister.componentClass
    this.tree = null
    this.popUps = {} // collection of PopUpInstance
    this.activePopUpName = undefined
    this.componentProps = {}
  }
}

class PopUpInstance {
  constructor (popUpName, componentClass, eventHandlers, title) {
    this.popUpName = popUpName
    this.title = title || 'Pop up'
    this.componentClass = componentClass
    this.eventHandlers = eventHandlers
    // vAlign and hAlign may override left and top setting
    this.vAlign = undefined 
    this.hAlign = undefined
    this.width = DEFAULT_POPUP_WIDTH
    this.height = DEFAULT_POPUP_HEIGHT
    this.left = DEFAULT_POPUP_LEFT
    this.top = DEFAULT_POPUP_TOP
    this.maximized = false
    this.visible = false
  }
}

class pageClassRegister {
  constructor (componentClass, {onShow, onHide, onClose}) {
    this.componentClass = componentClass;
    this.onShow = onShow;
    this.onHide = onHide;
    this.onClose = onClose;
  }
}

const PageFrame = React.memo( 
  (props) => (
    <div style={{display: props.visible ? "block" : "none"}}>
      {props.children}
    </div>
  )
)

var CHANGE_COUNTER = 0
function getNextChangeStamp() {
  CHANGE_COUNTER += 1
  return CHANGE_COUNTER
} 

var appFrameVars = {
  frameActive: true,
  pageClasses: {},
  changeStamp: 0, // increment changeStamp using getNextChangeStamp() to force all frames to re-render
  pageInstances: {}, // associated by instanceName
  modalStack: [], // stack of modal frames
  $: {
    instanceCounter: {}, // indexed by className
    instancesByClass: {}, // indexed by className
  },
  activeInstance: null,
  useInstanceTree: false, // whether use simple pageInstances or use instanceTree
  instanceTree: null, 
  /* 
    when instanceTree is set, all pageInstances must have been created
    instanceTree is recursive object of:
    - pages: object with instanceName as key
    - activeInstance: page instance object
    - subTrees: object with instance_name as key and contained instanceTree
  */
  instanceTreeIndexes: {}, 

  // events:
  onShow: (instance) => {},
  onClose: (instace) => {},
  onHide: (instance) => {},
};

function _setInstanceTree (vars, treeData, disabledTrees = []) {
  // treeData is array of ((page_instance_name) or object {name: (page_instance_name), pages: treeData}
  // disabledTrees are array of tree names that are to be disabled (frameActive set to false)

  var treeIndex = {}

  function __internalSetInstanceTree(parentTree, treeName, tree, pages) {

    var pageInst
    var elName

    tree.pageInstances = {}
    tree.activeInstance = null
    tree.subTrees = {}
    tree.frameActive = true
    tree.parentTree = parentTree
    tree.treeName = treeName

    for (var i = 0; i < pages.length; ++i) {
      var el = pages[i]
      elName = typeof(el) == 'object' ? el.name : el
      pageInst = vars.pageInstances[elName]
      
      if (pageInst) {
        tree.pageInstances[elName] = pageInst
        pageInst.tree = tree
        if (typeof(el) == 'object' && typeof(el.name) == 'string' && Array.isArray(el.pages)) {
          var subTree = {}
          var subTreeName = treeName + (treeName === '/' ? '' : '/') + el.name
          __internalSetInstanceTree(tree, subTreeName, subTree, el.pages)
          tree.subTrees[el.name] = subTree
          treeIndex[subTreeName] = subTree
        }
      }
    }
    if (Object.keys(tree.pageInstances).length > 0) {
      tree.activeInstance = tree.pageInstances[Object.keys(tree.pageInstances)[0]]
    }
  }

  if (!treeData) {
    return {...vars, useInstanceTree: false, instanceTree: null, instanceTreeIndexes: {}}
  }
  else {
    var tree = {}
    treeIndex['/'] = tree
    __internalSetInstanceTree(null, '/', tree, treeData)
    tree.frameActive = true
    for (var i = 0; i < disabledTrees.length; ++i) {
      var disabledTree = treeIndex[disabledTrees[i]]
      if (disabledTree)
        disabledTree.frameActive = false
    }
    var newVars = {...vars, useInstanceTree: true, instanceTree: tree, instanceTreeIndexes: treeIndex}
    window.setTimeout(() => {
      _triggerTreeEvents(newVars.instanceTree, newVars, 'show')
    }, 0)    
    return newVars
  }  
}

function _treeCheckVisibility (tree) {
  while (tree && tree.frameActive)
    tree = tree.parentTree
  return tree ? tree.frameActive : true
}

function _triggerTreeEvents (startTree, vars, eventType) {
  var eventF = eventType === 'show' ? vars.onShow : (eventType === 'hide' ? vars.onHide : undefined)
  if (typeof(eventF) == 'function') {
    var tree = startTree
    while (tree && tree.frameActive && tree.activeInstance) {
      eventF(tree.activeInstance)
      tree = tree.subTrees[tree.activeInstance.instanceName]
    }
  }
}

function _treeSwitchPage (vars, treeName, instanceName) {
  var tree = vars.instanceTreeIndexes[treeName]
  var subTree

  if (tree) {
    var prevActiveInstance = tree.activeInstance
    var newActiveInstance = tree.pageInstances[instanceName]

    if (newActiveInstance) {
      if (_treeCheckVisibility(tree) && newActiveInstance !== prevActiveInstance) {
        if (prevActiveInstance && vars.onHide) {
          vars.onHide(prevActiveInstance)
          // if has subtree, recurse hide event 
          subTree = tree.subTrees[prevActiveInstance.instanceName]
          _triggerTreeEvents(subTree, vars, 'hide')
        }
        if (vars.onShow) {
          vars.onShow(newActiveInstance)
          // if has subtree, traverse show event
          subTree = tree.subTrees[newActiveInstance.instanceName]
          _triggerTreeEvents(subTree, vars, 'show')
        }
      }
      tree.activeInstance = newActiveInstance;
      return {
        ...vars,
      }
    }
  }
}

function _treeActiveFrame (vars, treeName, isActive) {
  var tree = vars.instanceTreeIndexes[treeName]
  var subTree

  if (tree) {
    isActive = (isActive == null) ? !tree.frameActive : isActive
    if (tree.frameActive && !isActive) { // switch off
      if (_treeCheckVisibility(tree.parentTree))
        _triggerTreeEvents(tree, vars, 'hide')
      tree.frameActive = false
      return {...vars}
    }
    else
    if (!tree.frameActive && isActive) { // switch on
      tree.frameActive = true
      if (_treeCheckVisibility(tree.parentTree))
        _triggerTreeEvents(tree, vars, 'show')
      return {...vars}
    }
  }
}

function _triggerFirstShowEvent (vars) {
  if (!vars.useInstanceTree && vars.frameActive && vars.activeInstance && vars.onShow) {
    vars.onShow(vars.activeInstance)
  }
  else if (vars.useInstanceTree && vars.instanceTree.frameActive && vars.instanceTree.activeInstance && vars.onShow) {
    _triggerTreeEvents(vars.instanceTree, vars, 'show')
  }
}

var appFrameActions = {
  addPageClass: (vars, {className, componentClass, onShow, onHide, onClose}) => {
    var pageClass = new pageClassRegister(componentClass, {onShow, onHide, onClose})
    return {
      ...vars,
      pageClasses: {...vars.pageClasses, [className]: pageClass},
    }
  },
  setEventHandlers: (vars, {onShow, onClose, onHide}) => ({...vars, onShow, onClose, onHide}),
  createPageInstance: (vars, {treeName, className, isUnique, instanceName, title, suspendEvents, componentProps}) => {
    var $ = vars.$;
    var useTree = Boolean(treeName);
    var subTree;
    var pageClass = vars.pageClasses[className];
    if (!pageClass)
      throw new Error(`Unknown class register "${className}" `);

    var tree = useTree ? vars.instanceTreeIndexes[treeName] : null
    if (useTree && !tree)
      return

    var frameVisible = (!useTree && vars.frameActive) || (useTree && _treeCheckVisibility(tree))

    var prevActiveInstance = useTree ? tree.activeInstance : vars.activeInstance

    var prevInstance = $.instancesByClass[className];
    if (isUnique && prevInstance) {
      if (useTree && prevInstance.tree !== tree)
        return       
      if (!suspendEvents && frameVisible && prevActiveInstance && prevInstance !== prevActiveInstance) {
        // show / hide events here
        if (!useTree) {
          if (prevActiveInstance && vars.onHide) {
            vars.onHide(prevActiveInstance)
          }
          if (prevInstance && vars.onShow) {
            vars.onShow(prevInstance)
          }
        }
        else {
          if (prevActiveInstance && vars.onHide) {
            vars.onHide(prevActiveInstance)
            // if has subtree, recurse hide event 
            subTree = tree.subTrees[prevActiveInstance.instanceName]
            _triggerTreeEvents(subTree, vars, 'hide')
          }
          if (vars.onShow) {
            vars.onShow(prevInstance)
            // if has subtree, traverse show event
            subTree = tree.subTrees[prevInstance.instanceName]
            _triggerTreeEvents(subTree, vars, 'show')
          }
        }
      }

      prevInstance.componentProps = componentProps

      if (useTree) {
        tree.activeInstance = prevInstance
        return {...vars}
      }
      else {
        return {
          ...vars,
          activeInstance: prevInstance
        }
      }
    }
    if (!instanceName) {
      var cnt = $.instanceCounter[className] || 1;
      instanceName = 'frame_' + className + cnt.toString();
      $.instanceCounter[className] = cnt + 1;
    }

    var instance = new PageInstance(instanceName, className, pageClass, title);
    instance.tree = tree
    instance.componentProps = componentProps
    $.instancesByClass[className] = instance;

    if (!suspendEvents && frameVisible && prevActiveInstance !== instance) {
      // show / hide events here
      if (!useTree) {
        if (prevActiveInstance && vars.onHide) {
          vars.onHide(prevActiveInstance)
        }
        if (instance && vars.onShow) {
          vars.onShow(instance)
        }
      }
      else {
        if (prevActiveInstance && vars.onHide) {
          vars.onHide(prevActiveInstance)
          // if has subtree, recurse hide event 
          subTree = tree.subTrees[prevActiveInstance.instanceName]
          _triggerTreeEvents(subTree, vars, 'hide')
        }
        if (vars.onShow) {
          vars.onShow(instance)
          // if has subtree, traverse show event
          // commented --> assuming new page always 'flat' not containing subtrees
          // subTree = tree.subTrees[instance.instanceName]
          // _triggerTreeEvents(subTree, vars, 'show')
        }
      }
    }
    if (useTree) {
      tree.activeInstance = instance
      tree.pageInstances = {...tree.pageInstances, [instanceName]: instance}
      return {...vars, pageInstances: {...vars.pageInstances, [instanceName]: instance}}
    }
    else {
      return {
        ...vars,
        pageInstances: {...vars.pageInstances, [instanceName]: instance},
        activeInstance: instance
      }
    }
  }, 

  deletePageInstance: (vars, {treeName, instanceName}) => {
    var useTree = Boolean(treeName)
    var tree = useTree ? vars.instanceTreeIndexes[treeName] : null
    var subTree
    var newActiveInstance

    if (useTree && !tree)
      return

    var pageInstances = useTree ? tree.pageInstances : vars.pageInstances
    var pageInstance = pageInstances[instanceName]
    var frameVisible = (useTree && _treeCheckVisibility(tree)) || vars.frameActive

    if (pageInstance) {
      if (vars.onClose)
        vars.onClose(pageInstance);
      delete pageInstances[instanceName];
      delete vars.$.instancesByClass[pageInstance.className];
      if (!useTree)
        newActiveInstance = (vars.activeInstance && vars.activeInstance.instanceName === instanceName) ? 
        ((Object.keys(pageInstances).length > 0) ? pageInstances[Object.keys(pageInstances)[0]] : null) : vars.activeInstance
      else
        newActiveInstance = (tree.activeInstance && tree.activeInstance.instanceName === instanceName) ? 
        ((Object.keys(pageInstances).length > 0) ? pageInstances[Object.keys(pageInstances)[0]] : null) : tree.activeInstance

      if (frameVisible && vars.onShow)
        vars.onShow(newActiveInstance);

      if (!useTree) {
        return {...vars, pageInstances: pageInstances, activeInstance: newActiveInstance};
      }
      else {
        subTree = tree.subTrees[newActiveInstance.instanceName]
        _triggerTreeEvents(subTree, vars, 'show')
        tree.pageInstances = pageInstances
        tree.activeInstance = newActiveInstance
        return {...vars}
      }
    }
    else
      return undefined;
  }, // todo: use treeName

  clearPageInstances: (vars, {treeName}) => {
    var useTree = Boolean(treeName)
    var tree = useTree ? vars.instanceTreeIndexes[treeName] : null
    var new$ ={}

    if (useTree && !tree)
      return

    var pageInstances = useTree ? tree.pageInstances : vars.pageInstances
    var rootPageInstances = vars.pageInstances

    new$ = vars.$
    for (var instanceName in pageInstances) {
      var pageInstance = pageInstances[instanceName]
      if (vars.onClose)
        vars.onClose(pageInstance);
      delete pageInstances[instanceName];
      delete new$.instancesByClass[pageInstance.className];
      delete rootPageInstances[instanceName]
    }

    if (!useTree) // reset all instances
      return {...vars, $: new$, activeInstance: null, useInstanceTree: false, instanceTree: null, instanceTreeIndexes: {}, changeStamp: getNextChangeStamp()}
    else {
      tree.activeInstance = null
      return {...vars, $: new$, changeStamp: getNextChangeStamp()}
    }
  },

  switchPage: (vars, {treeName, instanceName}) => {
    
    if (vars.useInstanceTree) {
      return _treeSwitchPage(vars, treeName, instanceName)
    }
    else {
      var newActiveInstance = vars.pageInstances[instanceName];
      var prevActiveInstance = vars.activeInstance;

      if (newActiveInstance) {
        if (vars.frameActive && newActiveInstance != prevActiveInstance) {
          if (prevActiveInstance && vars.onHide)
            vars.onHide(prevActiveInstance);
          if (vars.onShow)
            vars.onShow(newActiveInstance);
        }
        return {
          ...vars,
          activeInstance: newActiveInstance
        }
      }
      else
        return undefined;
    }
  },

  setFrameActive: (vars, {treeName, isActive}) => {

    if (vars.useInstanceTree) {
      return _treeActiveFrame(vars, treeName, isActive)
    }
    else {
      if (vars.frameActive && !isActive && vars.onHide && vars.activeInstance) {
        vars.onHide(vars.activeInstance);
      } else if (!vars.frameActive && isActive && vars.onShow && vars.activeInstance) {
        vars.onShow(vars.activeInstance);
      }
      return {...vars, frameActive: isActive}
    }
  },

  toggleFrameActive: (vars, {treeName}) => {
    if (!vars.useInstanceTree) {
      if (vars.frameActive && vars.onHide && vars.activeInstance) {
        vars.onHide(vars.activeInstance);
      } else if (vars.activeInstance) {
        vars.onShow(vars.activeInstance);
      }
      return {...vars, frameActive: !vars.frameActive}
    }
    else
      return _treeActiveFrame(vars, treeName, null)
  },

  setInstanceTree: (vars, {treeData}) => _setInstanceTree(vars, treeData),

  triggerFirstShowEvent: (vars) => _triggerFirstShowEvent(vars),

  showModal: (vars, 
      {
        headerClass, contentClass, descClass, onOpen, onClose, size, dimmer, closeIcon,
        headerProps, contentProps
      }
    ) => (
    // size can be "mini", "tiny", "small", "large", "fullscreen"
    // default is "small"
    // dimmer can be true, "inverted", "blurring". default is true

    {
      ...vars, 
      modalStack: vars.modalStack.concat({
        headerClass: headerClass || ((props) => (<></>)), // default to empty JSX component
        contentClass, 
        descClass,
        onOpen,
        onClose, 
        closeIcon,
        size: size || "small", 
        dimmer: dimmer || true,
        headerProps: headerProps || {},
        contentProps: contentProps || {},
        popUps: {},
        activePopUpName: undefined
      })
    }
  ),

  closeModal: (vars, {result}) => {
    var topIndex = vars.modalStack.length - 1;
    var topStack = vars.modalStack[topIndex];
    if (typeof(topStack.onClose) == 'function')
      topStack.onClose(result)
    return {
      ...vars, 
      modalStack: vars.modalStack.slice(0, topIndex).concat(vars.modalStack.slice(topIndex + 1, )),
      // we define new modalStack by removing element at topIndex, without taking assumption
      // that topIndex is the last index. It is possible during onClose the modalStack array changes
    };
  },

  showPopUp: (vars, {
                      instanceName, popUpName, title, vAlign, hAlign, 
                      width, height, top, left, contentClass, eventHandlers, contentProps,
                      preventClose, preventMax, preventMove
                    }
    ) => { 
    // eventHandlers is object, may contain onShow, onHide, onClose event
    // instanceName is frame instance name, or if omited, will be the top modal
    // width, height, top, left can be number or css unit string (containng "px" or "%")
    // vAlign can be undefined, 'top', 'center', 'bottom', 'max'
    // hAlign can be undefined, 'left', 'center', 'right', 'max'
    // setting vAlign / hAlign other than undefined will override width, height, top, left values

    const getCSSCoordStr = (v, defaultValue) => (typeof(v) == 'string') ? v : (typeof(v) == 'number' ? v.toString() + 'px' : defaultValue)
    var frameInstance, modalInstance, topIndex, popUps, popUpInst

    if (instanceName) {
      frameInstance = vars.pageInstances[instanceName]
      if (!frameInstance)
        return
      popUps = frameInstance.popUps
      popUpInst = frameInstance.popUps[popUpName]
    }
    else {
      topIndex = vars.modalStack.length - 1
      if (topIndex < 0)
        return
      modalInstance = vars.modalStack[topIndex]
      popUps = modalInstance.popUps
      popUpInst = modalInstance.popUps[popUpName]
    }

    if (!popUpInst && (!contentClass || typeof(contentClass) != 'function')) 
      throw Error(`Mandatory parameter (contentClass) was omitted or invalid (not a class function)`)

    // hide all popus before activate one
    var popUpNames = Object.keys(popUps)
    popUpNames.forEach((item, index) => {popUps[item].visible = false})

    if (!popUpInst) {
      popUpInst = new PopUpInstance(popUpName, contentClass, eventHandlers, title)
      popUpInst.componentProps = contentProps || {}
      popUpInst.hAlign = hAlign
      popUpInst.vAlign = vAlign
      popUpInst.width = getCSSCoordStr(width, DEFAULT_POPUP_WIDTH)
      popUpInst.height = getCSSCoordStr(height, DEFAULT_POPUP_HEIGHT)
      popUpInst.top = getCSSCoordStr(top, DEFAULT_POPUP_TOP)
      popUpInst.left = getCSSCoordStr(left, DEFAULT_POPUP_LEFT)
      popUpInst.preventClose = preventClose
      popUpInst.preventMax = preventMax
      popUpInst.preventMove = preventMove
      popUpInst.visible = true
    }
    else {
      popUpInst.visible = true
    }

    if (frameInstance) {
      frameInstance.popUps[popUpName] = popUpInst
      frameInstance.activePopUpName = popUpName
    }
    else if (modalInstance) {
      modalInstance.popUps[popUpName] = popUpInst
      modalInstance.activePopUpName = popUpName
    }

    return {...vars, changeStamp: getNextChangeStamp()}
  },

  closePopUp: (vars, {instanceName}) => {
    var frameInstance, modalInstance, topIndex
    if (instanceName) {
      frameInstance = vars.pageInstances[instanceName]
      if (!frameInstance)
        return
      var popUpInst = frameInstance.popUps[frameInstance.activePopUpName]
    }
    else {
      topIndex = vars.modalStack.length - 1
      if (topIndex < 0)
        return
      modalInstance = vars.modalStack[topIndex]
      var popUpInst = modalInstance.popUps[modalInstance.activePopUpName]
    }

    if (popUpInst) {
      popUpInst.visible = false
      if (frameInstance)
        frameInstance.activePopUpName = undefined
      else if (modalInstance)
        modalInstance.activePopUpName = undefined
      return {...vars, changeStamp: getNextChangeStamp()}
    } // if popUpInst
  }

}

/* 
  AppFrameProvider is a provider component to supply all subcomponents with state from appFrameVars
  This component is usually mounted in render () of main App object
*/

class AppFrameProvider extends React.Component {
  render () {
    var initClasses = this.props.initialClasses;
    var actualInitClasses = {};
    var pageClass;

    if (typeof(initClasses) == 'object') {
      var initClassNames = Object.keys(initClasses);

      for (var i = 0; i < initClassNames.length; ++i) {
        var initClassName = initClassNames[i];
        var initClassInfo = initClasses[initClassName];
        if (typeof(initClassInfo) == 'object') {
          pageClass = new pageClassRegister(initClassInfo.class, {
            onShow: initClassInfo.onShow, 
            onHide: initClassInfo.onHide, 
            onClose: initClassInfo.onClose
          });
        }
        else {
          pageClass = new pageClassRegister(initClassInfo, {});
        }
        actualInitClasses[initClassName] = pageClass;
      } // for
    } // if

    var frameVars =  {...appFrameVars, pageClasses: actualInitClasses};
    if (Array.isArray(this.props.initialFrames)) {
      var initFrames = this.props.initialFrames;
      for (var i = 0; i < initFrames.length; ++i) {
        var {className, instanceName, title} = initFrames[i];
        frameVars = appFrameActions.createPageInstance(frameVars, {className, instanceName, title, isUnique: false, suspendEvents: true});
      }
      if (initFrames.length > 0 && !this.props.treeData)
        frameVars.activeInstance = frameVars.pageInstances[Object.keys(frameVars.pageInstances)[0]];
      if (Array.isArray(this.props.treeData)) {
        frameVars = appFrameActions.setInstanceTree(frameVars, {treeData: this.props.treeData})
      }
      // launch first event
      _triggerFirstShowEvent(frameVars)
    }

    const ProviderComponent = ContextProviderHook(AppFrameContext, appFrameActions, frameVars)

    return (
      <ProviderComponent initActions={this.props.initActions}>
        {this.props.children}
      </ProviderComponent>
    );
  }
}

/* 
  BasicHeaderComponent is default header component used by AppFrameBase, in case the headerComponent property
  is not defined in AppFrameBase 
*/
const BasicHeaderComponent = (props) => {
  return (
    <table>
      <tbody><tr>
        <td><h2><span style={props.headerStyle}>{props.title}</span></h2></td>
        <td>
          <span style={{display: !props.showCloseButton ? "none" : "block" }}>
            <button onClick={() => {props.closeHook()}}>Close</button>
          </span>
        </td>
      </tr></tbody>
    </table>
  );
}

class PopUpContainer extends React.Component {
  constructor (props) {
    super(props)
    this.dragging = false
    this.dragOffset = {x: 0, y: 0}
    this.dragDivPos = {x: 0, y: 0}
    this.containerDiv = undefined
    this.state = {maximized: false}
    // required props:
    // fmWidth, fmHeight, fmTop, fmLeft: string or undefined
    // hAlign, vAlign: string or undefined
    // componentClass: Function, title: string or undefined, componentProps: Object
    // preventClose: boolean
    // preventMove: boolean
    // preventMax: boolean
    
    // action / event props:
    // close()
    // updatePosition(top, left) --> synchronize DOM position with state position after dragging
  }

  onCloseClick = () => {
    this.props.close()
  }

  onMaximizeClick = () => {
    var cMaximized = this.state.maximized
    this.setState({maximized: !cMaximized})
  }

  mouseDown = (e) => {
    e.stopPropagation()
    if (this.props.preventMove || this.props.hAlign || this.props.vAlign || this.state.maximized)
      return
    e.preventDefault()
    this.dragging = true
    this.dragDivPos = {x: this.containerDiv.offsetLeft, y: this.containerDiv.offsetTop}
    this.dragOffset = {x: e.clientX, y: e.clientY}
  }

  mouseMove = (e) => {
    if (this.dragging) {
      e.preventDefault()
      e.stopPropagation()
      if (this.dragging) {
        var moveX = e.clientX - this.dragOffset.x
        var moveY = e.clientY - this.dragOffset.y
        this.dragDivPos.x += moveX; this.dragDivPos.y += moveY
        this.dragOffset.x += moveX; this.dragOffset.y += moveY
        this.containerDiv.style.left = this.dragDivPos.x.toString() + 'px'
        this.containerDiv.style.top = this.dragDivPos.y.toString() + 'px'
      }
    }
  }

  mouseUp = (e) => {
    if (this.dragging) {
      e.preventDefault()
      e.stopPropagation()
      this.dragging = false
      this.props.updatePosition(this.dragDivPos.x, this.dragDivPos.y)
    }
  }

  innerMouseDown = (e) => {
    e.stopPropagation()
  }

  render () {
    var p = this.props
    var drawMaximizeButton = (p.hAlign != 'max' || p.vAlign != 'max') && !p.preventMax
    var hStyle = this.state.maximized ? {left: '0%', width: '100%'} : 
      p.hAlign == 'left' ? {left: '0%', width: p.fmWidth} : 
      p.hAlign == 'center' ? {left: '50%', width: p.fmWidth, trX: '-50%'} : 
      p.hAlign == 'right' ? {right: '0%', width: p.fmWidth} : 
      p.hAlign == 'max' ? {left: '0%', width: '100%'} : 
      {left: p.fmLeft, width: p.fmWidth}

    var vStyle = this.state.maximized ? {top: '0%', height: '100%'} : 
      p.vAlign == 'top' ? {top: '0%', height: p.fmHeight} : 
      p.vAlign == 'center' ? {top: '50%', height: p.fmHeight, trY: '-50%'} : 
      p.vAlign == 'right' ? {bottom: '0%', height: p.fmHeight} : 
      p.vAlign == 'max' ? {top: '0%', height: '100%'} : 
      {top: p.fmTop, height: p.fmHeight}
    
    var spStyle = {...hStyle, ...vStyle, transform: `translate(${hStyle.trX || '0%'}, ${vStyle.trY || '0%'})`}
    delete spStyle.trX; delete spStyle.trY
    this.recentSPStyle = spStyle

    return (
      <div 
        style={{position: 'absolute', ...spStyle, backgroundColor: 'Window', paddingTop: '5px', paddingLeft: '5px', paddingBottom: '5px', paddingRight: '5px'}} 
        ref={(v) => {this.containerDiv = v}}
        onMouseDown={this.popUpMouseDown}
      >
        <div 
          style={{width: '100%', height: '30px', backgroundColor: 'grey', paddingLeft: '20px'}}
          onMouseDown={this.mouseDown}
          onMouseMove={this.mouseMove}
          onMouseUp={this.mouseUp} 
        >
          {p.title}&nbsp;&nbsp;
          {!p.preventClose ? <button onClick={this.onCloseClick}>x</button> : ''}
          {drawMaximizeButton ? <button onClick={this.onMaximizeClick}>{!this.state.maximized ? '<>' : '><'}</button> : ''}
        </div>
        <div onMouseDown={this.innerMouseDown}>
          <p.componentClass {...(p.componentProps || {})} />
        </div>
      </div>
    )
  }
}


/* 
  AppFrame_Base (and the connected to AppFrameContext - AppFrame) are components for displaying
  frame objects. Only one frame (activeInstance) is visible every time
  This component is usually mounted in render () of main App object
*/

class AppFrame_Base extends React.PureComponent {
  constructor (props) {
    super(props);
  }

  render () { 
    var {disp, meth} = this.props
    var pages = this.props.pageInstances
    var HeaderComponent = this.props.headerComponent || BasicHeaderComponent
    var activePage = this.props.activeInstance
    var headerComponentProps = HeaderComponent == BasicHeaderComponent ? 
      {headerStyle: this.props.headerStyle, showCloseButton: this.props.headerShowCloseButton} : {}

    var elements = Object.keys(pages).map(
        (instName) => {
          var page = pages[instName];
          var popUps = page.popUps
          var activePopUp = popUps[page.activePopUpName]
          var ContainedComponentClass = page.componentClass;
          const closeHook = () => {disp({type: 'deletePageInstance', instanceName: instName})};
          const componentProps = page.componentProps || {}
          return (
            <PageFrame 
              title={page.title} 
              visible={page == activePage}
              changeStamp={this.props.changeStamp}
              key={page.instanceName}
              instanceName={page.instanceName}
            >
              <div onMouseDown={(e) => {
                    disp({type: 'closePopUp', instanceName: instName})
                  }
                }
              >
                <HeaderComponent title={page.title} closeHook={closeHook} {...headerComponentProps} />
                <ContainedComponentClass instanceName={page.instanceName} {...componentProps} />
                {activePopUp ? 
                  <PopUpContainer
                    key={activePopUp.popUpName}
                    fmWidth={activePopUp.width} fmHeight={activePopUp.height} fmTop={activePopUp.top} fmLeft={activePopUp.left}
                    vAlign={activePopUp.vAlign} hAlign={activePopUp.hAlign}
                    componentClass={activePopUp.componentClass}
                    title={activePopUp.title}
                    componentProps={activePopUp.componentProps}
                    preventClose={activePopUp.preventClose}
                    preventMax={activePopUp.preventMax}
                    preventMove={activePopUp.preventMove}
                    close={() => disp({type: 'closePopUp', instanceName: instName})}
                    updatePosition={(x, y) => {activePopUp.left = x; activePopUp.top = y}}
                  /> : null
                }
              </div>
            </PageFrame>
          )
        }
      ) // map
    return (
      <div style={{display: this.props.frameActive ? "block" : "none"}}>
        {elements}
      </div>
    ) // return
  } // render
}

function _connectFrameTree(vars, ownProps) {
  var tree = vars.instanceTreeIndexes[ownProps.treeName]
  if (!tree) {
    return {
      frameActive: false,
      changeStamp: vars.changeStamp,
      pageInstances: {},
      activeInstance: null,
    }
  } else {
    return {
      frameActive: tree.frameActive,
      changeStamp: vars.changeStamp,
      pageInstances: tree.pageInstances,
      activeInstance: tree.activeInstance,
    }
  }
}

const AppFrame = ContextConnector(AppFrameContext, 
  (vars, ownProps) => (
    (vars.useInstanceTree || ownProps.treeName) ? _connectFrameTree(vars, ownProps) : {
        frameActive: vars.frameActive,
        changeStamp: vars.changeStamp,
        pageInstances: vars.pageInstances,
        activeInstance: vars.activeInstance,
      }
  )
)(AppFrame_Base);

/* 
  AppModal_Base (and the connected to AppFrameContext - AppModal) are components for displaying
  modal objects. Modals are stacked and only the top of the stack is accessible to user
  This component is usually mounted in render () of main App object
*/

class AppModal_Base extends React.PureComponent {
  constructor (props) {
    super(props);
    // props:
    // stack: array
    // closeModal: similar to closeModal action
  }

  onModalDefaultClose = () => { 
    // this event is occured when a modal is closed by standard UI action like pressing Esc or click close button
    // the closeHandler of the top stack will be called with result == null
    this.props.closeModal(null);
  }

  render () {
    var i;

    var modalStack = this.props.stack;
    var result = [];
    for (i = 0; i < modalStack.length; ++i) {
      var md = modalStack[i];
      var popUps = md.popUps
      let activePopUp = popUps[md.activePopUpName] // warning! never use var here, use let instead !
      
      result.push(
        <Modal 
          key={"modal" + i.toString()} 
          size={md.size} open={true} dimmer={md.dimmer}
          closeIcon={md.closeIcon} onClose={this.onModalDefaultClose}
          onOpen={md.onOpen}
        >
          <div onMouseDown={(e) => {
                    this.props.closePopUp()
                  }
                }
          >
            <Modal.Header><md.headerClass {...md.headerProps} /></Modal.Header>
            <Modal.Content><md.contentClass {...md.contentProps} /></Modal.Content>
            {activePopUp ? 
              (() => {
                return <PopUpContainer
                  key={activePopUp.popUpName}
                  fmWidth={activePopUp.width} fmHeight={activePopUp.height} fmTop={activePopUp.top} fmLeft={activePopUp.left}
                  vAlign={activePopUp.vAlign} hAlign={activePopUp.hAlign}
                  componentClass={activePopUp.componentClass}
                  title={activePopUp.title}
                  componentProps={activePopUp.componentProps}
                  preventClose={activePopUp.preventClose}
                  preventMax={activePopUp.preventMax}
                  preventMove={activePopUp.preventMove}
                  close={() => this.props.closePopUp()}
                  updatePosition={(x, y) => {activePopUp.left = x; activePopUp.top = y}}
                />
              })() : null
            }
          </div>
        </Modal>
      );
    }
    return result;
  }
}

const AppModal = ContextConnector(AppFrameContext, 
  (vars, ownProps) => ({
    stack: vars.modalStack,
    changeStamp: vars.changeStamp,
  }),
  (disp) => ({
    closeModal: (result) => disp({type: 'closeModal', result}),
    closePopUp: () => disp({type: 'closePopUp'})
  })
)(AppModal_Base);

/* 
  AppFrameAction_Base (and the connected to AppFrameContext - AppFrameAction) are dummy non-visual components 
  that gives access to AppFrame' user interface commands.
  This component can be mounted in render () part of any frame / user-interface part and then given the ref property
  to make access to AppFrame' UI commands easier
*/

class AppFrameAction extends React.PureComponent { // existing ...Action style helper object

  render () {
    return renderActionObject(AppFrameContext, this)
  }

  addClass (className, componentClass, events = {}) {
    this.disp({type: 'addPageClass',
      className, componentClass, 
      onShow: events.onShow, onHide: events.onHide, onClose: events.onShow
    }) 
  }
    
  createPage (className, instanceName, title, isUnique, treeName, componentProps) { this.disp({type: 'createPageInstance', className, isUnique, instanceName, title, treeName, componentProps}) }

  deletePage (instanceName) { this.disp({type: 'deletePageInstance', instanceName}) }

  clearPages (treeName) { this.disp({type: 'clearPageInstances', treeName}) }
  
  switchPage (instanceName, treeName) { this.disp({type: 'switchPage', treeName, instanceName}) }
  showModal (params) { this.disp({type: 'showModal', ...params}) }
  /* 
    available params:  
    headerClass, contentClass*, descClass, onClose, size, dimmer, closeIcon,
    headerProps, contentProps
    * = mandatory
  */
  closeModal (result) { this.disp({type: 'closeModal', result}) }
  setEventHandlers ({onShow, onHide, onClose}) { this.disp({type: 'setEventHandlers', onShow, onHide, onClose}) }

  triggerFirstShowEvent () { this.disp({type: 'triggerFirstShowEvent'}) }
  setMainFrameActive (isActive) { this.disp({type: 'setFrameActive', treeName: '/', isActive}) }
  setFrameActive (treeName, isActive) { this.disp({type: 'setFrameActive', treeName, isActive}) }

  showPopUp (instanceName, popUpName, contentClass, contentProps, title, dim, flags, eventHandlers) {
    dim = dim || {}
    flags = flags || {}
    this.disp({
      type: 'showPopUp', 
      instanceName, popUpName, title, 
      vAlign: dim.vAlign, hAlign: dim.hAlign, top: dim.top, left: dim.left, 
      height: dim.height, width: dim.width, 
      contentClass, eventHandlers: eventHandlers || {}, contentProps: contentProps || {}, 
      preventClose: flags.preventClose, preventMax: flags.preventMax, preventMove: flags.preventMove
    })
  }

  closePopUp (instanceName, popUpName) { this.disp({type: 'closePopUp', instanceName, popUpName}) }

  async showModalAsync(modalSettings) {
    return new Promise(
      (resolve, reject) => {
        const onClose = (result) => {
          resolve(result)
        }
        modalSettings.onClose = onClose
        this.showModal(modalSettings)
      }
    )
  }

  async showMessage(message, title, settings) { // setting keys: message_type: ('message' (default), 'warning', 'error')
    return new Promise (
      (resolve, reject) => {
        const onClose = (result) => {
          resolve(result)
        }
        this.showModal({title: title || 'Message', contentClass: MessageModalComponent, onClose, size: 'mini', closeIcon: false})
      }
    )
  }
}

const MessageModalComponent = (props) => {
  return <div>
    <span>{props.message}</span><br /><br />
    <button>Close</button>
  </div>
}

export {AppFrame, AppModal, AppFrameProvider, AppFrameAction, AppFrameContext, PageFrame};
