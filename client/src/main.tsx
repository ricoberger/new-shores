import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initPwa } from "./pwa";
import { Root } from "./ui/Root";
import "./ui/global.css";

initPwa();

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
