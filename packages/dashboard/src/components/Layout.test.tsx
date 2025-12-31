import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Layout from './Layout';

// Helper to render with router context
const renderWithRouter = (component: React.ReactElement): ReturnType<typeof render> => {
  return render(
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      {component}
    </BrowserRouter>
  );
};

describe('Layout', () => {
  it('renders header with app name', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('ILP Network Visualizer')).toBeInTheDocument();
  });

  it('renders version number in header', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it('applies dark theme classes', () => {
    const { container } = renderWithRouter(<Layout />);
    const header = container.querySelector('header');
    expect(header).toHaveClass('bg-gray-800');
  });

  it('renders header with correct styling classes', () => {
    const { container } = renderWithRouter(<Layout />);
    const header = container.querySelector('header');
    expect(header).toHaveClass('text-white');
    expect(header).toHaveClass('py-4');
    expect(header).toHaveClass('px-6');
  });
});
