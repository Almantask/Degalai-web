import { registerSW } from "virtual:pwa-register";
import { startApp } from "./app.ts";
import "./styles.css";

registerSW({ immediate: true });

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("#app missing");
void startApp(root);
