import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardHome from './pages/DashboardHome';

function App(): JSX.Element {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardHome />} />
          {/* Future routes:
            - /packets/:id (packet detail inspection)
            - /nodes/:id (node status inspection)
            - /logs (log viewer)
          */}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
