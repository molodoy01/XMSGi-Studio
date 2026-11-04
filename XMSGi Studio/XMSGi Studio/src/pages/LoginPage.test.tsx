import type { ComponentProps } from 'react';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyColorTheme, COLOR_THEME_STORAGE_KEY } from '@/lib/colorTheme';
import { LocaleProvider } from '@/lib/i18n';
import { LoginPage } from './LoginPage';

function renderLogin(overrides: Partial<ComponentProps<typeof LoginPage>> = {}) {
  const props: ComponentProps<typeof LoginPage> = {
    connecting: false,
    signedOut: false,
    returningUserName: '',
    returningUserUsername: '',
    authStep: 'phone',
    showAuthForm: false,
    phoneNumber: '',
    phoneCode: '',
    twoFactorPassword: '',
    authBusy: false,
    authError: '',
    authNotice: false,
    setShowAuthForm: vi.fn(),
    setAuthStep: vi.fn(),
    setPhoneNumber: vi.fn(),
    setPhoneCode: vi.fn(),
    setTwoFactorPassword: vi.fn(),
    setAuthError: vi.fn(),
    handleTelegramAuth: vi.fn().mockResolvedValue(undefined),
    handleWelcomeBack: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return {
    ...render(<LocaleProvider><LoginPage {...props} /></LocaleProvider>),
    props,
  };
}

function renderToggleLogin() {
  const props = renderLoginProps({});

  function LoginHarness() {
    const [showAuthForm, setShowAuthForm] = useState(false);
    return (
      <LocaleProvider>
        <LoginPage {...props} showAuthForm={showAuthForm} setShowAuthForm={setShowAuthForm} />
      </LocaleProvider>
    );
  }

  return render(<LoginHarness />);
}

describe('LoginPage', () => {
  afterEach(() => {
    applyColorTheme('light');
    localStorage.removeItem(COLOR_THEME_STORAGE_KEY);
  });

  it.each([false, true])('hides language controls on the login and welcome-back screens (signed out: %s)', (signedOut) => {
    const { container } = renderLogin({ signedOut });

    expect(screen.queryByRole('group', { name: 'Language' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'RU' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'EN' })).not.toBeInTheDocument();
    expect(container.querySelector('.auth-screen')).toHaveAttribute('lang');
    if (signedOut) {
      expect(container.querySelector('.login-returning-user')).toBeInTheDocument();
    } else {
      expect(container.querySelector('.login-returning-user')).not.toBeInTheDocument();
    }
  });

  it('toggles the saved color theme from one icon button', () => {
    applyColorTheme('light');
    localStorage.removeItem(COLOR_THEME_STORAGE_KEY);
    const { container } = renderLogin();
    const themeButton = screen.getByRole('button', { name: 'Switch to dark theme' });

    expect(container.querySelectorAll('.auth-theme-button')).toHaveLength(1);
    fireEvent.click(themeButton);

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('light');
  });

  it('opens Telegram sign-in and resets the form to the phone step', () => {
    const { props } = renderLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Telegram' }));

    expect(props.setShowAuthForm).toHaveBeenCalledOnce();
    expect(props.setAuthStep).toHaveBeenCalledWith('phone');
    expect(props.setAuthError).toHaveBeenCalledWith('');
  });

  it('provides a localized tooltip hint for the sign-in divider button', () => {
    const { container } = renderLogin();
    const divider = container.querySelector('.login-divider');

    expect(divider).toHaveAttribute('aria-label', 'Sign in');
    expect(divider).toHaveAttribute('data-tooltip', 'Sign in');
    expect(divider?.querySelector('.login-button-tooltip')).toHaveTextContent('Sign in');
  });

  it('adds the international prefix when phone entry starts with digits', () => {
    const { props } = renderLogin();

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '14155550123' } });

    expect(props.setPhoneNumber).toHaveBeenCalledWith('+14155550123');
  });

  it('submits the phone number through the login form submit handler', () => {
    const { container, props } = renderLogin({ showAuthForm: true, phoneNumber: '+14155550123' });

    fireEvent.submit(container.querySelector('.login-form')!);

    expect(props.handleTelegramAuth).toHaveBeenCalledOnce();
  });

  it('allows removing the automatically added phone prefix', () => {
    const { props } = renderLogin({ phoneNumber: '+14155550123' });

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '14155550123' } });

    expect(props.setPhoneNumber).toHaveBeenCalledWith('14155550123');
  });

  it('does not show a generic hint before an auth message exists', () => {
    const { container } = renderLogin({ showAuthForm: true });

    expect(container.querySelector('.login-error')).not.toBeInTheDocument();
  });

  it('keeps auth errors in the shared message slot above the form', () => {
    const { container } = renderLogin({ showAuthForm: true, authError: 'Check the phone number.' });

    const status = container.querySelector('.login-error');
    const form = container.querySelector('.login-form');
    const slot = container.querySelector('.login-error-slot');

    expect(status).toHaveTextContent('Check the phone number.');
    expect(slot?.nextElementSibling).toBe(form);
    expect(slot?.classList.contains('has-message')).toBe(true);
    expect(slot?.querySelector('.login-error-slot-content')?.firstElementChild).toBe(status);
  });

  it('shows the two-factor password prompt as an informational status', () => {
    const { container } = renderLogin({
      showAuthForm: true,
      authStep: 'password',
      authError: 'Code accepted. Your Telegram account has two-step verification enabled. Enter your password to continue.',
      authNotice: true,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Code accepted.');
    expect(container.querySelector('.login-error')).toHaveClass('is-info');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the offline warning on the initial screen without opening the sign-in form', () => {
    const { container } = renderLogin();

    fireEvent(window, new Event('online'));
    fireEvent(window, new Event('offline'));

    expect(screen.getByRole('status')).toHaveTextContent('No internet connection');
    expect(container.querySelector('.login-error-slot')).toContainElement(screen.getByRole('status'));
    expect(container.querySelector('.login-form')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.login-divider')).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.auth-screen')).not.toHaveClass('is-auth-open');
    expect(container.querySelector('.connection-spinner')).not.toBeInTheDocument();
  });

  it('shows offline status in the shared message slot after opening sign-in', () => {
    const { container } = renderLogin({ showAuthForm: true });

    fireEvent(window, new Event('offline'));

    expect(screen.getByRole('status')).toHaveTextContent('No internet connection');
    expect(container.querySelector('.login-error-slot')).toContainElement(screen.getByRole('status'));
    expect(container.querySelector('.connection-spinner')).not.toBeInTheDocument();
  });

  it('shows a taller status card with a circular spinner while checking the connection', () => {
    const { container } = renderLogin({ connecting: true });
    const spinner = container.querySelector('.connection-spinner');
    const card = container.querySelector('.connection-status-card');
    const ring = spinner?.querySelector('.connection-spinner-ring');

    expect(spinner).toHaveAttribute('role', 'status');
    expect(card).toHaveTextContent('Checking your connection…');
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    expect(ring).toHaveClass('connection-spinner-ring');
    expect(ring).not.toHaveClass('is-square');
    expect(ring?.children).toHaveLength(0);
    expect(ring?.querySelector('.connection-spinner-core')).not.toBeInTheDocument();
    expect(spinner?.querySelector('.connection-spinner-inline')).not.toBeInTheDocument();
  });

  it('aligns the open phone input with the center of the Studio wordmark', () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('login-wordmark-bottom')) return new DOMRect(0, 180, 100, 40);
      if (this.id === 'login-phone') return new DOMRect(0, 280, 200, 55);
      return new DOMRect(0, 0, 0, 0);
    });

    try {
      const { container } = renderLogin({ showAuthForm: true });

      expect(container.querySelector('.login-panel'))
        .toHaveStyle('--login-panel-offset: -107.5px');
    } finally {
      bounds.mockRestore();
    }
  });

  it('keeps the first auth field aligned with Studio through code and password steps', () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('login-wordmark-bottom')) return new DOMRect(0, 180, 100, 40);
      if (this.id === 'login-code' || this.id === 'login-password') return new DOMRect(0, 280, 200, 55);
      return new DOMRect(0, 0, 0, 0);
    });

    try {
      const { container, rerender } = renderLogin({ showAuthForm: true, authStep: 'code' });

      expect(container.querySelector('.login-panel'))
        .toHaveStyle('--login-panel-offset: -107.5px');

      rerender(<LocaleProvider><LoginPage {...renderLoginProps({ showAuthForm: true, authStep: 'password' })} /></LocaleProvider>);

      expect(container.querySelector('.login-panel'))
        .toHaveStyle('--login-panel-offset: -107.5px');
    } finally {
      bounds.mockRestore();
    }
  });

  it('anchors short and medium errors together while keeping tall errors higher', () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('login-layout')) return new DOMRect(0, 200, 700, 355);
      if (this.classList.contains('login-wordmark-bottom')) return new DOMRect(0, 180, 100, 40);
      if (this.classList.contains('login-error')) {
        const text = this.textContent ?? '';
        const isShortError = text.includes('Untrusted renderer');
        const isTallError = text.includes('authorization server');
        return new DOMRect(0, isShortError ? 300 : isTallError ? 200 : 240, 300, isShortError ? 43 : isTallError ? 180 : 63);
      }
      if (this.classList.contains('login-error-slot')) {
        const text = this.textContent ?? '';
        const isShortError = text.includes('Untrusted renderer');
        const isTallError = text.includes('authorization server');
        return new DOMRect(0, isShortError ? 300 : isTallError ? 200 : 240, 300, isShortError ? 43 : isTallError ? 180 : 63);
      }
      if (this.id === 'login-phone' || this.id === 'login-password') return new DOMRect(0, 280, 200, 55);
      return new DOMRect(0, 0, 0, 0);
    });

    try {
      const { container, rerender } = renderLogin({
        showAuthForm: true,
        authStep: 'phone',
        authError: 'Error invoking remote method: Untrusted renderer.',
      });

      expect(container.querySelector('.login-panel'))
        .toHaveStyle('--login-panel-offset: -60px');

      rerender(<LocaleProvider><LoginPage {...renderLoginProps({
        showAuthForm: true,
        authStep: 'password',
        authError: 'The two-step verification password is incorrect. Try again.',
      })} /></LocaleProvider>);

      expect(container.querySelector('.login-panel'))
        .toHaveStyle('--login-panel-offset: 0px');

      rerender(<LocaleProvider><LoginPage {...renderLoginProps({
        showAuthForm: true,
        authStep: 'phone',
        authError: 'Telegram authorization server returned an unexpected response.',
      })} /></LocaleProvider>);

      expect(container.querySelector('.login-panel'))
        .toHaveStyle('--login-panel-offset: -20px');
    } finally {
      bounds.mockRestore();
    }
  });

  it('shows the Studio message while returning to a saved account', () => {
    renderLogin({ connecting: true, openingStudio: true });

    expect(screen.getByRole('status')).toHaveTextContent('Opening Studio…');
    expect(screen.queryByText('Checking your connection…')).not.toBeInTheDocument();
  });

  it('closes the form when Continue is clicked a second time', () => {
    const { container } = renderToggleLogin();
    const continueButton = screen.getByRole('button', { name: 'Continue with Telegram' });
    const form = container.querySelector('.login-form');

    expect(continueButton).toHaveAttribute('aria-controls', 'telegram-login-form');
    expect(continueButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(continueButton);
    expect(form).toHaveClass('is-visible');
    expect(continueButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(continueButton);
    expect(form).not.toHaveClass('is-visible');
    expect(continueButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the form when Telegram is clicked a second time', () => {
    const { container } = renderToggleLogin();
    const telegramButton = screen.getByRole('button', { name: 'TELEGRAM' });
    const form = container.querySelector('.login-form');

    expect(telegramButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(telegramButton);
    expect(form).toHaveClass('is-visible');
    expect(telegramButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(telegramButton);
    expect(form).not.toHaveClass('is-visible');
    expect(telegramButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('replaces the code field with the two-factor password in the same slot', () => {
    const { rerender } = renderLogin({ showAuthForm: true, authStep: 'code' });

    expect(screen.getByLabelText('Login code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Two-step verification password')).not.toBeInTheDocument();

    rerender(<LocaleProvider><LoginPage {...renderLoginProps({ showAuthForm: true, authStep: 'password' })} /></LocaleProvider>);

    expect(screen.queryByLabelText('Login code')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Two-step verification password')).toBeInTheDocument();
    expect(document.querySelectorAll('.login-field')).toHaveLength(1);
  });

  it('offers one-click return for a saved account after sign-out', () => {
    const { container, props } = renderLogin({
      signedOut: true,
      returningUserName: 'Alex Example',
    });

    expect(screen.getByText('WELCOME BACK,')).toBeInTheDocument();
    const returnButton = screen.getByRole('button', { name: 'Continue as Alex Example' });
    const greeting = screen.getByText('WELCOME BACK,');
    expect(greeting.nextElementSibling).toBe(returnButton);
    expect(returnButton).toHaveTextContent('Continue as Alex Example');
    expect(returnButton.querySelector('.login-button-tooltip')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with Telegram' })).not.toBeInTheDocument();
    expect(container.querySelector('.login-divider')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.login-divider')).not.toBeInstanceOf(HTMLButtonElement);

    fireEvent.click(returnButton);
    expect(props.handleWelcomeBack).toHaveBeenCalledOnce();
  });

  it('does not open sign-in from the divider on the saved-account screen', () => {
    const { container, props } = renderLogin({ signedOut: true, returningUserName: 'Alex Example' });
    const divider = container.querySelector('.login-divider');

    fireEvent.click(divider!);

    expect(props.setShowAuthForm).not.toHaveBeenCalled();
  });

  it('opens phone sign-in from the saved-account screen', () => {
    const { container, props } = renderLogin({ signedOut: true, returningUserName: 'Alex Example', phoneNumber: '+14155550123' });
    const method = container.querySelector('.login-method');
    const messageSlot = container.querySelector('.login-error-slot');
    const startOver = screen.getByRole('button', { name: 'Use a different phone number' });

    expect(method?.nextElementSibling).toBe(messageSlot);
    expect(messageSlot?.nextElementSibling).toBe(startOver);

    fireEvent.click(startOver);

    expect(props.setShowAuthForm).toHaveBeenCalledWith(true);
    expect(props.setAuthStep).toHaveBeenCalledWith('phone');
    expect(props.setPhoneNumber).toHaveBeenCalledWith('');
    expect(props.setAuthError).toHaveBeenCalledWith('');
  });

  it('clears the previous phone number when restarting from code entry', () => {
    const { container, props } = renderLogin({ showAuthForm: true, authStep: 'code', phoneNumber: '+14155550123' });

    fireEvent.click(container.querySelector('.login-back-button')!);

    expect(props.setAuthStep).toHaveBeenCalledWith('phone');
    expect(props.setPhoneNumber).toHaveBeenCalledWith('');
    expect(props.setPhoneCode).toHaveBeenCalledWith('');
    expect(props.setTwoFactorPassword).toHaveBeenCalledWith('');
  });
});

function renderLoginProps(overrides: Partial<ComponentProps<typeof LoginPage>>): ComponentProps<typeof LoginPage> {
  return {
    connecting: false,
    signedOut: false,
    returningUserName: '',
    returningUserUsername: '',
    authStep: 'phone' as const,
    showAuthForm: false,
    phoneNumber: '',
    phoneCode: '',
    twoFactorPassword: '',
    authBusy: false,
    authError: '',
    authNotice: false,
    setShowAuthForm: vi.fn(),
    setAuthStep: vi.fn(),
    setPhoneNumber: vi.fn(),
    setPhoneCode: vi.fn(),
    setTwoFactorPassword: vi.fn(),
    setAuthError: vi.fn(),
    handleTelegramAuth: vi.fn().mockResolvedValue(undefined),
    handleWelcomeBack: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}