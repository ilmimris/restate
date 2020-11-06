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
            ID: 0,
            text: "Learn about React",
            isCompleted: false
        },
        {
            ID: 1,
            text: "Meet friend for lunch",
            isCompleted: false
        },
        {
            ID: 2,
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
    setTodos: (state, { todos }) => ({ ...state, todos }),

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
        // newTodos[index].isCompleted = true;

        newTodos[index] = {...newTodos[index], isCompleted: true}

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

// Only restore state if there's no deep link and we're not on web
const loadState = async () => {
    const savedStateString = localStorage.getItem(PERSISTENCE_KEY);
    return (savedStateString ? JSON.parse(savedStateString) : undefined);
}

// Get State from ref
const getState = async (disp) => {
    var ref = {}
    await yieldEventLoop()
    disp({type: 'getState', ref})
    return ref.state;
};


// standard "templates" for visual components to connect
const AppInterfaces = {
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

    todoInfo: ContextConnector(AppContext,
        (state, props) => ({
            todos: state.todos
        }),
        (disp) => ({
            addTodo: async (text) => {
                var state = await getState();

                const newTodos = [...state.todos, { text, isCompleted: false }];

                this.disp({ type: 'setTodos', todos: newTodos })
                // await this.storeState();
            },

            completeTodo: async (index) => {
                var state = await getState();

                const newTodos = [...state.todos];

                newTodos[index] = {...newTodos[index], isCompleted: true}

                this.disp({ type: 'setTodos', todos: newTodos })
                // await this.storeState();
            },

            removeTodo: async (index) =>  {
                var state = await getState();

                const newTodos = [...state.todos];
                newTodos.splice(index, 1);

                this.disp({ type: 'setTodos', todos: newTodos })
                // await this.storeState();
            },
        })
    ),
}

export { AppProvider, AppContext, AppAction, AppInterfaces };
