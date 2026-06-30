import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Self-host Inter weights used by the design system (replaces stripped Google Fonts @import)
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";

createRoot(document.getElementById("root")!).render(<App />);
