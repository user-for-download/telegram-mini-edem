import { Hono } from "hono";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import { queriesRouter } from "./queries.js";
import { createRouter } from "./create.js";
import { statusRouter } from "./status.js";
import { cancelRouter } from "./cancel.js";

export const bookingsRouter = new Hono<AuthEnv>();

bookingsRouter.use("*", requireUser);

bookingsRouter.route("/", queriesRouter);
bookingsRouter.route("/", createRouter);
bookingsRouter.route("/", statusRouter);
bookingsRouter.route("/", cancelRouter);
