// WORLD DOMINATION — entry point.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './style.css';
import { initApp } from './ui/app.js';
import { showMainMenu } from './ui/menu.js';
import './ui/panels.js';
import './ui/country.js';

initApp();
showMainMenu();
