/**
 * Test preload (see bunfig.toml). Forces an ephemeral in-memory database so the
 * test suite never touches a real DATA_DIR. Runs before any module imports the
 * config singleton.
 */
process.env.DATA_DIR = ":memory:";
