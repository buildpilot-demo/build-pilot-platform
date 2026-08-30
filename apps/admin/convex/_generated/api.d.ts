/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * Hand-written placeholder -- see dataModel.d.ts for why. Regenerate with
 * `npx convex dev` once a real deployment exists (it will also pick up any
 * modules added since this file was written by hand).
 *
 * @module
 */

import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server'
import type * as businesses from '../businesses.js'
import type * as lib_externalCall from '../lib/externalCall.js'
import type * as lib_stageAttempt from '../lib/stageAttempt.js'

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  businesses: typeof businesses
  'lib/externalCall': typeof lib_externalCall
  'lib/stageAttempt': typeof lib_stageAttempt
}>

export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>
