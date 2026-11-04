import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTestbenchColorTheme } from '../shared/testbenchTheme';
import { LocaleProvider } from '@/lib/i18n';
import { LoginTestbench } from './LoginTestbench';

const loginPageStyles = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages/LoginPage.css'),
  'utf8',
);
const themeTransitionStyles = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles/tokens.css'),
  'utf8',
);

describe('LoginTestbench', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    applyTestbenchColorTheme('light');
    window.dispatchEvent(new Event('online'));
    window.localStorage.clear();
  });

  it('starts on the sign-in screen without an error and can switch to the scenario gallery', () => {
    render(<LocaleProvider><LoginTestbench /></LocaleProvider>);

    expect(screen.getByRole('button', { name: 'Continue with Telegram' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Phone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Preview state')).toHaveValue('initial');

    fireEvent.click(screen.getByRole('button', { name: 'All scenarios' }));
    expect(screen.getByRole('heading', { name: 'All sign-in scenarios' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(12);
    for (const label of [
      'Initial sign-in',
      'Phone validation error',
      'Long server error',
      'Untrusted renderer',
      'Code entry',
      'Code error',
      'Two-step verification',
      'Password error',
      'Saved account',
      'Connecting',
      'Opening Studio',
      'No internet',
    ]) {
      expect(screen.getByRole('article', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('article', { name: 'Long server error' })).toHaveTextContent('authorization server returned an unexpected response');
    expect(screen.getByRole('article', { name: 'Untrusted renderer' }))
      .toHaveTextContent("Error invoking remote method 'telegram-auth-state': Error: Untrusted renderer.");
    expect(screen.getByRole('article', { name: 'No internet' })).toHaveTextContent('No internet connection');
    expect(screen.getByRole('article', { name: 'Opening Studio' })).toHaveTextContent('Opening Studio…');
    expect(screen.getByRole('article', { name: 'Opening Studio' }).querySelector('.login-testbench-preview-fields')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Single scenario' }));
    expect(screen.getByLabelText('Preview state')).toBeInTheDocument();
  });

  it('synchronizes the primary slogan color transition with the hero heading', () => {
    render(<LocaleProvider><LoginTestbench /></LocaleProvider>);
    const sharedColorRule = loginPageStyles.match(
      /\.login-wordmark-top,\s*\.login-tagline > span:first-child\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    const sharedTransitionRule = themeTransitionStyles.match(
      /html\.is-theme-transitioning body :where\(\*\)\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(sharedColorRule).toMatch(/color:\s*var\(--login-ink\);/);
    expect(sharedTransitionRule).toMatch(/transition-duration:\s*320ms/);
    expect(sharedTransitionRule).toMatch(/transition-delay:\s*0ms,\s*0ms/);
    expect(sharedTransitionRule).toMatch(/transition-timing-function:\s*cubic-bezier\(0\.22, 0\.61, 0\.36, 1\)/);
  });

  it('previews validation, code, password, account, loading, and offline states', () => {
    render(<LocaleProvider><LoginTestbench /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Single scenario' }));
    const statePicker = screen.getByLabelText('Preview state');

    fireEvent.change(statePicker, { target: { value: 'phone-error' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid phone number');

    fireEvent.change(statePicker, { target: { value: 'long-error' } });
    expect(screen.getByRole('alert').textContent!.length).toBeGreaterThan(200);

    fireEvent.change(statePicker, { target: { value: 'renderer-error' } });
    expect(screen.getByRole('alert'))
      .toHaveTextContent("Error invoking remote method 'telegram-auth-state': Error: Untrusted renderer.");
    expect(screen.getByRole('textbox', { name: 'Phone' })).toBeInTheDocument();

    fireEvent.change(statePicker, { target: { value: 'code' } });
    expect(screen.getByLabelText('Login code')).toBeInTheDocument();

    fireEvent.change(statePicker, { target: { value: 'code-error' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The code expired. Request a new one.');

    fireEvent.change(statePicker, { target: { value: 'password' } });
    expect(screen.getByLabelText('Two-step verification password')).toBeInTheDocument();

    fireEvent.change(statePicker, { target: { value: 'password-error' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The two-step verification password is incorrect.');

    fireEvent.change(statePicker, { target: { value: 'saved-account' } });
    expect(screen.getByText('WELCOME BACK,')).toBeInTheDocument();

    fireEvent.change(statePicker, { target: { value: 'loading' } });
    expect(document.querySelector('.connection-spinner'))
      .toHaveAttribute('role', 'status');
    expect(document.querySelector('.connection-status-card'))
      .toHaveTextContent('Checking your connection…');

    fireEvent.change(statePicker, { target: { value: 'opening-studio' } });
    expect(document.querySelector('.connection-spinner'))
      .toHaveAttribute('role', 'status');
    expect(document.querySelector('.connection-status-card'))
      .toHaveTextContent('Opening Studio…');

    fireEvent.change(statePicker, { target: { value: 'offline' } });
    expect(screen.getByRole('status')).toHaveTextContent('No internet connection. Reconnect and try again.');
    expect(screen.getByRole('button', { name: 'Continue with Telegram' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Phone' })).not.toBeInTheDocument();

    fireEvent.change(statePicker, { target: { value: 'initial' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Telegram' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts in English without a language control in the testbench toolbar', () => {
    render(<LocaleProvider><LoginTestbench /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Single scenario' }));
    const testbenchControls = within(screen.getByRole('navigation', { name: 'Login testbench controls' }));

    expect(screen.getByRole('button', { name: 'Continue with Telegram' })).toBeInTheDocument();
    expect(testbenchControls.queryByRole('group', { name: 'Language' })).not.toBeInTheDocument();
    expect(testbenchControls.queryByRole('button', { name: 'EN' })).not.toBeInTheDocument();
    expect(testbenchControls.queryByRole('button', { name: 'RU' })).not.toBeInTheDocument();
  });

  it('switches themes and returns to a clean initial login screen', () => {
    render(<LocaleProvider><LoginTestbench /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Single scenario' }));
    fireEvent.change(screen.getByLabelText('Preview state'), { target: { value: 'code-error' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Reset sign-in' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Telegram' })).toHaveAttribute('aria-expanded', 'false');
  });
});
