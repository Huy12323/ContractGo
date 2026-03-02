import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App } from 'antd'
import { queryClient } from '@/lib/query-client'
import { routeTree } from './routeTree.gen'
import { initAuth } from '@/stores/auth'

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
initAuth()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#1677ff',
            borderRadius: 6,
          },
        }}
      >
        <App>
          <RouterProvider router={router} />
        </App>
      </ConfigProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
