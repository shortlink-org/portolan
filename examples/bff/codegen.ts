// The resolvers are generated from the schema, not the other way round.
//
// `server-preset` writes one file per field - `src/schema/basket/resolvers/
// Query/basket.ts` - the first time it sees it, and leaves it alone
// afterwards, so the body below the signature is written once by a person and
// the signature above it moves with the schema. What it regenerates every run
// are the `*.generated.ts` files: the types, and the schema the server is
// built from.
import { defineConfig } from "@eddeee888/gcg-typescript-resolver-files";
import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "src/schema/**/schema.graphql",
  emitLegacyCommonJSImports: false,
  generates: {
    "src/schema": defineConfig({
      resolverGeneration: "minimal",
      resolverMainFile: "resolvers.generated.ts",
      typesPluginsConfig: {
        contextType: "../infrastructure/transport/graphql/context.ts#GraphQLContext",
        useTypeImports: true,
      },
    }),
  },
};

export default config;
