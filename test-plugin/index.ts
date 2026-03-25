const plugin = {
  id: "test-tool-plugin",
  name: "Test Tool Plugin",
  description: "Minimal plugin to test tool registration",
  register(api: any) {
    api.registerTool(
      (_ctx: any) => ({
        name: "test_hello",
        description: "A simple test tool that returns a greeting",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute() {
          return {
            content: [{ type: "text", text: "Hello from test-tool-plugin!" }],
          };
        },
      }),
      { name: "test_hello" },
    );

    api.logger.info("[test-tool-plugin] Tool registered");
  },
};

export default plugin;
