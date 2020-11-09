export function ContextProviderHook(context: any, actionHandlers?: any, initState?: any): (props: any) => any;
export function ContextConnector(context: any, stateFilter?: any, dispatchPropsCreator?: any, mixPropsCreator?: any, dispatchPropName?: any, methodsPropName?: any): (Component: any) => (props: any) => any;
export function renderActionObject(context: any, actionInstance?: any, statePropMaps?: any): any;
export function yieldEventLoop(): Promise<any>;
