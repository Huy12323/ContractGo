import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Provider_ANTD } from '@/providers/antd/Provider_ANTD'
import { queryClient } from '@/lib/query-client'
import { routeTree } from './routeTree.gen'
import { Store_Auth_Actions } from '@/stores/Store_Auth'

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Initialize auth listener before rendering
Store_Auth_Actions.initAuth()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider_ANTD>
        <RouterProvider router={router} />
      </Provider_ANTD>
    </QueryClientProvider>
  </React.StrictMode>,
)
