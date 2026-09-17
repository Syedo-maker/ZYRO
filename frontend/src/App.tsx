import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'
import { AdminLayout } from './pages/admin/AdminLayout'
import { ProductsPage } from './pages/admin/ProductsPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="products" replace />} />
            <Route path="products" element={<ProductsPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/admin/products" replace />} />
          <Route path="*" element={<Navigate to="/admin/products" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
