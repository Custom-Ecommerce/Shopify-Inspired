// SB-6 (verification bug 1): imported BEFORE the models by scripts/ensure-indexes.mjs. Mongoose builds every collection (autoCreate) and every
// index (autoIndex) of a model when the connection opens, so a script that only wants to LOOK would create them all, dry run included. Switching
// both off globally, before any model is compiled, makes the dry run read-only: --apply (createIndexes() per model) is then the only thing that
// creates. ES module imports run in the order they are written, so this file must be imported above the db-schemas import.
import mongoose from 'mongoose';

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

/** The connect options that say the same on the connection itself (belt and braces: a connection option wins over the global one). */
export const NO_AUTO_CONNECT_OPTIONS = Object.freeze({ autoIndex: false, autoCreate: false });
