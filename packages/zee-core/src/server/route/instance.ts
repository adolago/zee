import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { Instance } from "../../project/instance"
import { Global } from "../../global"
import { Worktree } from "../../worktree"
import { Project } from "../../project/project"
import { Vcs } from "../../project/vcs"
import { errors } from "../error"

export const InstanceRoute = new Hono()
  .post(
    "/instance/dispose",
    describeRoute({
      summary: "Dispose instance",
      description: "Clean up and dispose the current agent-core instance, releasing all resources.",
      operationId: "instance.dispose",
      responses: {
        200: {
          description: "Instance disposed",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    async (c) => {
      await Instance.dispose()
      return c.json(true)
    },
  )
  .get(
    "/path",
    describeRoute({
      summary: "Get paths",
      description: "Retrieve the current working directory and related path information for the agent-core instance.",
      operationId: "path.get",
      responses: {
        200: {
          description: "Path",
          content: {
            "application/json": {
              schema: resolver(
                z
                  .object({
                    home: z.string(),
                    state: z.string(),
                    config: z.string(),
                    worktree: z.string(),
                    directory: z.string(),
                  })
                  .meta({
                    ref: "Path",
                  }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({
        home: Global.Path.home,
        state: Global.Path.state,
        config: Global.Path.config,
        worktree: Instance.worktree,
        directory: Instance.directory,
      })
    },
  )
  .post(
    "/experimental/worktree",
    describeRoute({
      summary: "Create worktree",
      description: "Create a new git worktree for the current project.",
      operationId: "worktree.create",
      responses: {
        200: {
          description: "Worktree created",
          content: {
            "application/json": {
              schema: resolver(Worktree.Info),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", Worktree.create.schema),
    async (c) => {
      const body = c.req.valid("json")
      const worktree = await Worktree.create(body)
      return c.json(worktree)
    },
  )
  .get(
    "/experimental/worktree",
    describeRoute({
      summary: "List worktrees",
      description: "List all sandbox worktrees for the current project.",
      operationId: "worktree.list",
      responses: {
        200: {
          description: "List of worktree directories",
          content: {
            "application/json": {
              schema: resolver(z.array(z.string())),
            },
          },
        },
      },
    }),
    async (c) => {
      const sandboxes = await Project.sandboxes(Instance.project.id)
      return c.json(sandboxes)
    },
  )
  .get(
    "/vcs",
    describeRoute({
      summary: "Get VCS info",
      description: "Retrieve version control system (VCS) information for the current project, such as git branch.",
      operationId: "vcs.get",
      responses: {
        200: {
          description: "VCS info",
          content: {
            "application/json": {
              schema: resolver(Vcs.Info),
            },
          },
        },
      },
    }),
    async (c) => {
      const branch = await Vcs.branch()
      return c.json({
        branch,
      })
    },
  )
