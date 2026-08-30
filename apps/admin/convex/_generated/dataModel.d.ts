/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * Hand-written placeholder: no Convex deployment has been created yet in
 * this environment, so `npx convex dev` could not generate this file. Once
 * a deployment exists (see docs/task-plan.md T0.1), run `npx convex dev`
 * once and let it overwrite everything under `convex/_generated/`.
 *
 * @module
 */

import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from 'convex/server'
import type { GenericId } from 'convex/values'
import schema from '../schema.js'

/**
 * The names of all of your Convex tables.
 */
export type TableNames = TableNamesInDataModel<DataModel>

/**
 * The type of a document stored in Convex.
 */
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>

/**
 * An identifier for a document in Convex.
 */
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>

/**
 * A type describing your Convex data model.
 */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>
