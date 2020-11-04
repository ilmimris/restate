import React from 'react'

// application-logic libraries
import { AppProvider, AppInterfaces } from './App.Data';


// application-UI-pages goes here
import Main from "./Main";

const MainApp = AppInterfaces.appLoad(Main);

function App() {
    return (
        <AppProvider>
            <MainApp />
        </AppProvider>
    );
}

export default App
