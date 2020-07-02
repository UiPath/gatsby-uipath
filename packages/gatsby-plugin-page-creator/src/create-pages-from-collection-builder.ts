// Move this to gatsby-core-utils?
import { Actions, CreatePagesArgs } from "gatsby"
import { reverseLookupParams } from "./extract-query"
import { getMatchPath } from "./get-match-path"
import { createPath } from "gatsby-page-utils"
import { getCollectionRouteParams } from "./get-collection-route-params"
import { derivePath } from "./derive-path"
import { watchCollectionBuilder } from "./watch-collection-builder"
import { collectionExtractQueryString } from "./collection-extract-query-string"

// TODO: Do we need the ignore argument?
export async function createPagesFromCollectionBuilder(
  filePath: string,
  absolutePath: string,
  actions: Actions,
  graphql: CreatePagesArgs["graphql"]
): Promise<void> {
  validateUnstableUsage(filePath)

  // 1. Query for the data for the collection to generate pages
  const queryString = collectionExtractQueryString(absolutePath)

  // 1.a  If the query string is not findable, we can't move on. So we stop and watch
  if (queryString === null) {
    watchCollectionBuilder(absolutePath, ``, [], actions, () =>
      createPagesFromCollectionBuilder(filePath, absolutePath, actions, graphql)
    )
    return
  }

  const { data, errors } = await graphql<{ nodes: Record<string, unknown> }>(
    queryString
  )

  // 1.a If it fails, we need to inform the user and exit early
  if (!data || errors) {
    console.warn(`Tried to create pages from the collection builder found at ${filePath}.
Unfortunately, the query came back empty. There may be an error in your query.`)
    console.error(errors)

    watchCollectionBuilder(absolutePath, queryString, [], actions, () =>
      createPagesFromCollectionBuilder(filePath, absolutePath, actions, graphql)
    )

    return
  }

  // 2. Get the nodes out of the data. We very much expect data to come back in a known shape:
  //    data = { [key: string]: { nodes: Array<ACTUAL_DATA> } }
  const nodes = (Object.values(Object.values(data)[0])[0] as any) as Array<
    Record<string, object>
  >

  if (nodes) {
    console.info(`CollectionPageCreator:`)
    console.info(`   Creating ${nodes.length} pages from ${filePath}`)
  }

  // 3. Loop through each node and create the page, also save the path it creates to pass to the watcher
  //    the watcher will use this data to delete the pages if the query changes significantly.
  const paths = nodes.map((node: Record<string, object>) => {
    // URL path for the component and node
    const path = createPath(derivePath(filePath, node))
    // Params is supplied to the FE compoent on props.params
    const params = getCollectionRouteParams(createPath(filePath), path)
    // nodeParams is fed to the graphql query for the component
    const nodeParams = reverseLookupParams(node, absolutePath)
    // matchPath is an optional value. It's used if someone does a path like `{foo}/[bar].js`
    const matchPath = getMatchPath(path)

    console.info(`   ${matchPath.matchPath || path}`)

    actions.createPage({
      path: path,
      ...matchPath,
      component: absolutePath,
      context: {
        ...nodeParams,
        __params: params,
      },
    })

    return path
  })

  watchCollectionBuilder(absolutePath, queryString, paths, actions, () =>
    createPagesFromCollectionBuilder(filePath, absolutePath, actions, graphql)
  )
}

function validateUnstableUsage(filePath: string): void {
  let shouldThrow = false

  filePath.split(`/`).forEach(part => {
    if (part.startsWith(`{`) && part.startsWith(`{unstable_`) === false) {
      shouldThrow = true
    }
  })

  if (shouldThrow) {
    console.error(`Creating collection routes in gatsby with the filesystem is an experimental feature. We require files to use the prefix 'unstable_' in each segment.

Your current path:
src/pages/${filePath}

Change it to this:
src/pages/${filePath.replace(/\{/g, `{unstable_`)}`)
    process.exit(1)
  }
}
