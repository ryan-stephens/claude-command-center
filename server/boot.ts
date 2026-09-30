// Imported first by server/index.ts, so the settings file is in the environment (and the company's
// certificates trusted) before any other module reads CC_CONTROL_* while loading.
import { applyConfig } from './config.ts';

applyConfig();
