export const OrchletMcpTools = [
  {
    name: "orchlet_orchestrate",
    description: "Submit a high-level intent to Orchlet to autonomously plan, implement, test, review, and babysit a PR",
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "Clear statement of what outcome to deliver",
        },
        routingMode: {
          type: "string",
          enum: ["AUTO", "CHEAP", "QUALITY", "BEST"],
          description: "Model selection strategy",
          default: "AUTO",
        },
      },
      required: ["intent"],
    },
  },
  {
    name: "orchlet_status",
    description: "Check the current status and attention state of active Orchlet tasks",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID to query. Omit to list all active tasks.",
        },
      },
    },
  },
];
