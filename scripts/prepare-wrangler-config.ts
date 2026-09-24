#!/usr/bin/env tsx

import { applyTopLevelPatch, applyVarsPatch, ensureMinimumConfigVersion, prepareConfigFile } from './wrangler-config/patches';
import { provisionWranglerResources } from './wrangler-config/resources';

prepareConfigFile();
ensureMinimumConfigVersion();
applyTopLevelPatch();
applyVarsPatch();
provisionWranglerResources();
console.log('Wrangler configuration is ready.');
