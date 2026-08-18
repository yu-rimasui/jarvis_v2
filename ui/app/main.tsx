import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { routerBasename } from "../shared/runtime.js";
import { App } from "./App.js";
import "./styles.css";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Jarvis UI root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
