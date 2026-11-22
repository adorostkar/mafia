import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { AppBoundary } from "./App";
import "@fontsource-variable/manrope";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/vazirmatn";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
  </StrictMode>,
);
