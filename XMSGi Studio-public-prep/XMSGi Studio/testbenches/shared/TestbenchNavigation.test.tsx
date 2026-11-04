import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TestbenchNavigation } from './TestbenchNavigation';

describe('TestbenchNavigation', () => {
  it('shares the same page selector and active-page state across page testbenches', () => {
    render(
      <TestbenchNavigation
        locale="en"
        setLocale={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        scenarioLabel="Error scenario"
        scenario="none"
        scenarioOptions={[{ value: 'none', label: 'No error' }]}
        onScenarioChange={vi.fn()}
        onReset={vi.fn()}
        resetLabel="Reset"
        currentPage="studio"
      />,
    );

    const navigation = screen.getByRole('navigation', { name: 'Stand controls' });
    const pages = within(navigation).getByRole('combobox', { name: 'Testbench pages' });
    expect(pages).toHaveValue('/testbenches/studio-editor/');
    expect(within(pages).getByRole('option', { name: 'Login' })).toHaveValue('/testbenches/login/');
    expect(within(pages).getByRole('option', { name: 'Planner' })).toHaveValue('/testbenches/planner/');
    expect(within(pages).getByRole('option', { name: 'Activity' })).toHaveValue('/testbenches/activity/');
    expect(within(pages).getByRole('option', { name: 'Settings' })).toHaveValue('/testbenches/settings/');
    expect(within(pages).getByRole('option', { name: 'All pages' })).toHaveValue('/testbenches/');
  });

  it('exposes the shared scenario, language, theme, and reset actions', () => {
    const setLocale = vi.fn();
    const onThemeChange = vi.fn();
    const onScenarioChange = vi.fn();
    const onReset = vi.fn();

    render(
      <TestbenchNavigation
        locale="en"
        setLocale={setLocale}
        theme="light"
        onThemeChange={onThemeChange}
        scenarioLabel="Error scenario"
        scenario="none"
        scenarioOptions={[
          { value: 'none', label: 'No error' },
          { value: 'long', label: 'Long error' },
        ]}
        onScenarioChange={onScenarioChange}
        onReset={onReset}
        resetLabel="Reset"
        currentPage="planner"
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Error scenario' }), { target: { value: 'long' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'RU' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onScenarioChange).toHaveBeenCalledWith('long');
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(setLocale).toHaveBeenCalledWith('ru');
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('exposes an optional confirmation scenario selector', () => {
    const onConfirmationScenarioChange = vi.fn();

    render(
      <TestbenchNavigation
        locale="en"
        setLocale={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        scenarioLabel="Error scenario"
        scenario="none"
        scenarioOptions={[{ value: 'none', label: 'No error' }]}
        onScenarioChange={vi.fn()}
        confirmationLabel="Confirmation scenario"
        confirmationScenario="none"
        confirmationOptions={[
          { value: 'none', label: 'No confirmation' },
          { value: 'delete-draft', label: 'Delete draft' },
        ]}
        onConfirmationScenarioChange={onConfirmationScenarioChange}
        onReset={vi.fn()}
        resetLabel="Reset"
        currentPage="studio"
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Confirmation scenario' }), {
      target: { value: 'delete-draft' },
    });

    expect(onConfirmationScenarioChange).toHaveBeenCalledWith('delete-draft');
  });

  it('selects the standalone Activity testbench as the active page', () => {
    render(
      <TestbenchNavigation
        locale="en"
        setLocale={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        scenarioLabel="Activity scenario"
        scenario="empty"
        scenarioOptions={[{ value: 'empty', label: 'No sends' }]}
        onScenarioChange={vi.fn()}
        onReset={vi.fn()}
        resetLabel="Reset"
        currentPage="activity"
      />,
    );

    const navigation = screen.getByRole('navigation', { name: 'Stand controls' });
    expect(within(navigation).getByRole('combobox', { name: 'Testbench pages' })).toHaveValue('/testbenches/activity/');
  });

  it('changes sections through browser history without navigating the document', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const popState = vi.fn();
    window.addEventListener('popstate', popState);
    render(
      <TestbenchNavigation
        locale="en"
        setLocale={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        scenarioLabel="Activity scenario"
        scenario="empty"
        scenarioOptions={[{ value: 'empty', label: 'No sends' }]}
        onScenarioChange={vi.fn()}
        onReset={vi.fn()}
        resetLabel="Reset"
        currentPage="activity"
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Testbench pages' }), {
      target: { value: '/testbenches/planner/' },
    });

    expect(pushState).toHaveBeenCalledWith({}, '', expect.any(URL));
    expect(popState).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/testbenches/planner/');
    window.removeEventListener('popstate', popState);
    pushState.mockRestore();
  });

  it('shows the optional connection control in the top navigation', () => {
    const onConnectionSpinnerToggle = vi.fn();
    render(
      <TestbenchNavigation
        locale="en"
        setLocale={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        scenarioLabel="Activity scenario"
        scenario="error"
        scenarioOptions={[{ value: 'error', label: 'History error' }]}
        onScenarioChange={vi.fn()}
        onReset={vi.fn()}
        resetLabel="Reset"
        currentPage="activity"
        connectionSpinnerVisible={false}
        onConnectionSpinnerToggle={onConnectionSpinnerToggle}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    expect(onConnectionSpinnerToggle).toHaveBeenCalledOnce();
  });
});
