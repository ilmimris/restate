import React from 'react';
import {
    ContextProviderHook,
    ContextConnector,
    renderActionObject,
    yieldEventLoop
} from 'restate/src/appcontext';

const PERSISTENCE_KEY = 'todoapp';

var AppState = {
    todos: [
        {
            text: "Learn about React",
            isCompleted: false
        },
        {
            text: "Meet friend for lunch",
            isCompleted: false
        },
        {
            text: "Build really cool todo app",
            isCompleted: false
        },
    ],

    globals: {},  // global object for storing shared libaries and functions
    modules: {}, // loaded modules from server
}

var AppReducers = {
    getState: (state, { ref }) => { ref.state = { ...state } },
    restoreState: (state, { newState }) => ({ ...state, ...newState }),


    // Todos reducer
    setTodo: (state, { todos }) => ({ ...state, todos }),

    setGlobal: (state, { key, value }) => ({ ...state, globals: { ...state.globals, [key]: value } }),
    setModule: (state, { moduleName, imports }) => ({ ...state, modules: { ...state.modules, [moduleName]: imports } })
}

const AppContext = React.createContext(null)

const ProviderComponent = ContextProviderHook(AppContext, AppReducers, AppState)

class AppProvider extends React.Component {

    constructor(props) {
        super(props);

        this.disp = null;
        this.meth = null;
    }

    render() {
        return (
            <ProviderComponent refDispatch={
                (dispatch, method) => { this.disp = dispatch; this.meth = method }
            } >
                {this.props.children}
            </ProviderComponent>
        );
    };
}

const persistState = (state) => {
    return {
        todos: state.todos,
    }
}

class AppAction extends React.PureComponent {

    // implicit properties (added by renderActionObject)
    // disp : reference to dispatch

    render() {
        return renderActionObject(AppContext, this, (state) => { })
    }

    async storeState() {
        var state = await this.getState();
        const pState = persistState(state);
        console.log(`state to store ${JSON.stringify(pState)}`);
        localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(pState))
    }

    async getState() {
        var ref = {}
        await yieldEventLoop()
        this.disp({ type: 'getState', ref })
        return ref.state
    }

    async addTodo(text) {
        var state = await this.getState();

        const newTodos = [...state.todos, { text, isCompleted: false }];

        this.disp({ type: 'setTodos', todos: newTodos })
        await this.storeState();

    }

    async completeTodo(index) {
        var state = await this.getState();

        const newTodos = [...state.todos];
        newTodos[index].isCompleted = true;

        this.disp({ type: 'setTodos', todos: newTodos })
        await this.storeState();

    }

    async removeTodo(index) {
        var state = await this.getState();

        const newTodos = [...state.todos];
        newTodos.splice(index, 1);

        this.disp({ type: 'setTodos', todos: newTodos })
        await this.storeState();

    }

}

const loadState = async () => {
    // Only restore state if there's no deep link and we're not on web
    const savedStateString = localStorage.getItem(PERSISTENCE_KEY);
    return (savedStateString ? JSON.parse(savedStateString) : undefined);
}

const AppInterfaces = { // standard "templates" for visual components to connect
    appLoad: ContextConnector(AppContext,
        (state, props) => ({
            store: state
        }),
        (disp) => ({
            loadStore: async () => {
                const state = await loadState();
                if (state !== undefined) {
                    disp({ type: 'restoreState', newState: state })
                }
            },

            saveStore: async () => {
                var ref = {}
                await yieldEventLoop()
                disp({ type: 'getState', ref })
                const pState = persistState(ref.state);
                localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(pState));
            },

        })
    ),
}

export { AppProvider, AppContext, AppAction, AppInterfaces };
