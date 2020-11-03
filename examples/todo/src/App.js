import * as React from 'react';
import AppearanceProvider from "./config/provider/AppearanceProvider";

// application-logic libraries
import { AppProvider, AppInterfaces } from './App.Data';

// application-UI-pages goes here
import { Landing } from "./pages/Landing";

function MainApp_ ({loadStore, saveStore, timeControl, ...props}) {
    const [isReady, setIsReady] = React.useState(false);
    //const [appState, _setAppState] = React.useState(AppState.currentState);
    const appStateRef = React.useRef(AppState.currentState);

    //const setAppState = (state) => {
    //    console.log(`before ${appStateRef.current}`);
    //    appStateRef.current = state;
    //    _setAppState(state);
    //}

    const handleAppStateChange = (state) => {
        lastState = appStateRef.current;
        appStateRef.current = state;
        console.log(`handle statechange from ${lastState} to ${state}`)
        timeControl(lastState, state);
        //setAppState(state);
    }
      
    React.useEffect(() => {
        const restoreState = async () => {
            try {
                await loadStore();
            } finally {
                setIsReady(true);
            }
        };
    
        AppState.addEventListener('change', handleAppStateChange);
        if (!isReady) {
            setTimeout(() => restoreState(), 2500);
            //restoreState();
        }
        return (async () => {
            console.log('before unmount');
            AppState.removeEventListener('change', handleAppStateChange);
            await saveStore();
        })
    }, []);
//    }, [isReady]);

/*    React.useEffect(() => {
        AppState.addEventListener('change', handleAppStateChange);
        
        return (async () => {
            console.log('before unmount');
            AppState.removeEventListener('change', handleAppStateChange);
            await saveStore();
        })
    }, []);
*/
    //React.useEffect(() => {
        //console.log(appState);
    //});    

    if (!isReady) {
        //return <ActivityIndicator size="large" />;
        return <SplashScreen />;
    }
  
    return (
        <NavigationContainer>
            <MainNav />
        </NavigationContainer>
    );
}

const MainApp = AppInterfaces.appLoad(MainApp_);

function App(){
    return (
        <PaperProvider>
            <AppearanceProvider>
                <AppProvider>
                    <MainApp />
                </AppProvider>
            </AppearanceProvider>
        </PaperProvider>
    );
}

export default App;
