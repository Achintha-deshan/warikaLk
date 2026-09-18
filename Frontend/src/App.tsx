import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import DashboardPage from './pages/DashboardPage'
import CustomersPage from './pages/CustomersPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import StaffPage from './pages/StaffPage'
import AppLayout from './components/AppLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import LoansPage from './pages/LoansPage'
import CreateLoanPage from './pages/CreateLoanPage'
import LoanDetailPage from './pages/LoanDetailPage'
import InterestPaymentsPage from './pages/InterestPaymentsPage'
import CapitalLossPage from './pages/CapitalLossPage'
import AgentPerformancePage from './pages/AgentPerformancePage'
import PlatformLoginPage from './pages/PlatformLoginPage'
import PlatformDashboardPage from './pages/PlatformDashboardPage'
import PlatformProtectedRoute from './components/PlatformProtectedRoute'
import MonthlyReportPage from './pages/MonthlyReportPage'
import DailyReportPage from './pages/DailyReportPage'

export default function App() {
  return <BrowserRouter><Routes>
    <Route path="/" element={<Navigate to="/daily-report" replace />} />
    <Route path="/signup" element={<SignupPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/platform/login" element={<PlatformLoginPage />} />
    <Route path="/platform/dashboard" element={<PlatformProtectedRoute><PlatformDashboardPage /></PlatformProtectedRoute>} />
    <Route element={<ProtectedRoute />}><Route element={<AppLayout />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/customers" element={<CustomersPage />} />
      <Route path="/customers/:id" element={<CustomerDetailPage />} />
      <Route path="/loans" element={<LoansPage />} />
      <Route path="/loans/new" element={<CreateLoanPage />} />
      <Route path="/loans/:id" element={<LoanDetailPage />} />
      <Route path="/daily-report" element={<DailyReportPage />} />
      <Route path="/monthly-report" element={<MonthlyReportPage />} />
      <Route path="/interest-payments" element={<InterestPaymentsPage />} />
      <Route element={<ProtectedRoute ownerOnly />}>
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/capital-loss" element={<CapitalLossPage />} />
        <Route path="/agent-performance" element={<AgentPerformancePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/daily-report" replace />} />
    </Route></Route>
  </Routes></BrowserRouter>
}