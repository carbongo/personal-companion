import "@fontsource/cinzel/400.css";
import "@fontsource/cinzel/600.css";
import "@fontsource-variable/outfit";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Lift the boot veil once the first frame has painted.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const boot = document.getElementById("boot");
    if (!boot) return;
    boot.classList.add("gone");
    setTimeout(() => boot.remove(), 700);
  });
});
