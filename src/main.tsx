import { render } from "@solidjs/web"
import { startAnalytics } from "./analytics.ts"
import { App } from "./App.tsx"
import "./styles.css"

render(() => <App />, document.getElementById("root")!)
startAnalytics()
