import type { ComponentProps } from 'react';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyColorTheme, COLOR_THEME_STORAGE_KEY } from '@/lib/colorTheme';
import { LocaleProvider } from '@/lib/i18n';
import { LoginPage } from './LoginPage';

const loginPageStyles = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'LoginPage.css'), 'utf8');
const appStyles = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8');
const colorThemeStyles = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'colorThemes.css'), 'utf8');

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
    handleForgetAccount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return {
    ...render(<LocaleProvider><LoginPage {...props} /></LocaleProvider>),
    props,
  };
}

function renderToggleLogin(initial: Partial<ComponentProps<typeof LoginPage>> = {}) {
  const props = renderLoginProps(initial);

  function LoginHarness() {
    const [showAuthForm, setShowAuthForm] = useState(props.showAuthForm);
    const [authStep, setAuthStep] = useState(props.authStep);
    const [phoneNumber, setPhoneNumber] = useState(props.phoneNumber);
    const [phoneCode, setPhoneCode] = useState(props.phoneCode);
    const [twoFactorPassword, setTwoFactorPassword] = useState(props.twoFactorPassword);
    const [authError, setAuthError] = useState(props.authError);
    return (
      <LocaleProvider>
        <LoginPage
          {...props}
          showAuthForm={showAuthForm}
          setShowAuthForm={setShowAuthForm}
          authStep={authStep}
          setAuthStep={setAuthStep}
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
          phoneCode={phoneCode}
          setPhoneCode={setPhoneCode}
          twoFactorPassword={twoFactorPassword}
          setTwoFactorPassword={setTwoFactorPassword}
          authError={authError}
          setAuthError={setAuthError}
        />
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
      expect(container.querySelector('.auth-screen')).toHaveClass('is-returning');
    } else {
      expect(container.querySelector('.login-returning-user')).not.toBeInTheDocument();
      expect(container.querySelector('.auth-screen')).not.toHaveClass('is-returning');
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

  it('positions the theme switch five pixels below the top edge on auth screens', () => {
    expect(appStyles).toMatch(/\.auth-top-controls\s*\{[^}]*position:\s*fixed;[^}]*top:\s*32px;/);
  });

  it('opens Telegram sign-in without resetting the current authorization step', () => {
    const { props } = renderLogin();

    const rowButton = screen.getByRole('button', { name: 'Continue with Telegram' });
    expect(rowButton).toHaveClass('login-method-action');
    expect(rowButton.querySelectorAll('button')).toHaveLength(0);
    fireEvent.click(rowButton.querySelector('.login-arrow')!);

    expect(props.setShowAuthForm).toHaveBeenCalledOnce();
    expect(props.setAuthStep).not.toHaveBeenCalled();
    expect(props.setAuthError).not.toHaveBeenCalled();
  });

  it('changes the full sign-in row color on hover in the light theme', () => {
    expect(loginPageStyles).toMatch(/\.login-method-action\s*\{[^}]*color:\s*var\(--login-ink\);/);
    expect(loginPageStyles).toMatch(/\.login-method-action:hover\s*\{\s*color:\s*var\(--login-gold\);/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.login-method-action\s*\{\s*color:\s*#f0f2f4;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.login-method-action:hover\s*\{\s*color:\s*var\(--login-studio\);/);
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

  it('requires a two-factor password before enabling its submit button', () => {
    renderLogin({
      showAuthForm: true,
      authStep: 'password',
      phoneCode: '12345',
    });

    expect(screen.getByRole('button', { name: 'Verify and connect' })).toBeDisabled();
  });

  it('submits a two-factor password without requiring the code field', () => {
    const { container, props } = renderLogin({
      showAuthForm: true,
      authStep: 'password',
      twoFactorPassword: 'correct-password',
    });

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

  it('keeps the registration form centered with the initial and returning screens', () => {
    expect(loginPageStyles).toMatch(/\.auth-panel\.auth-screen\s*\{[^}]*box-sizing:\s*border-box;[^}]*display:\s*flex;[^}]*min-height:\s*calc\(100dvh - var\(--electron-titlebar-height,\s*0px\)\);[^}]*flex:\s*1 0 auto;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/);
    expect(appStyles).toMatch(/\.product-shell:has\(\.auth-panel\) > \.topbar-placeholder\s*\{\s*display:\s*none;/);
    expect(appStyles).toMatch(/\.product-shell:has\(\.auth-panel\) > \.product-shell-content\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/);
    expect(appStyles).toMatch(/\.app:has\(\.auth-panel\)\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/);
    expect(loginPageStyles).toMatch(/@media \(min-width: 461px\)\s*\{[\s\S]*?\.login-layout\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*355px;/);
    expect(loginPageStyles).toMatch(/\.login-panel\s*\{[^}]*align-self:\s*center;/);
    expect(loginPageStyles).not.toMatch(/login-panel-offset|login-layout\s*\{\s*transform:\s*translateY/);

    const initialScreen = renderLogin({ showAuthForm: true });
    expect(initialScreen.container.querySelector('.login-panel')?.getAttribute('style') ?? '')
      .not.toContain('login-panel-offset');
    initialScreen.unmount();

    const returningScreen = renderLogin({ signedOut: true });
    expect(returningScreen.container.querySelector('.login-panel')?.getAttribute('style') ?? '')
      .not.toContain('login-panel-offset');
  });

  it('lowers the open phone field to align with the Studio wordmark on desktop', () => {
    expect(loginPageStyles).toMatch(/\.auth-screen\.is-auth-open \.login-field-label\[for="login-phone"\],\s*\.auth-screen\.is-auth-open #login-phone,\s*\.auth-screen\.is-auth-open \.login-field-label\[for="login-code"\],\s*\.auth-screen\.is-auth-open #login-code\s*\{\s*top:\s*32px;/);
  });

  it('slightly lowers the Continue with Telegram row while registration is open', () => {
    expect(loginPageStyles).toMatch(/\.auth-screen\.is-auth-open \.login-method\s*\{\s*transform:\s*translateY\(8px\);/);
  });

  it('slightly lowers the Continue with Telegram row only while registration is closed', () => {
    expect(loginPageStyles).toMatch(/\.auth-screen:not\(\.is-auth-open\) \.login-method:not\(\.is-returning\)\s*\{\s*transform:\s*translateY\(8px\);/);
  });

  it('lowers the entire login panel only while registration is open', () => {
    expect(loginPageStyles).toMatch(/\.login-panel\s*\{[^}]*transform:\s*translate\(7px,\s*0\);/);
    expect(loginPageStyles).toMatch(/\.auth-screen\.is-auth-open \.login-panel\s*\{\s*transform:\s*translate\(7px,\s*16px\);/);
  });

  it('keeps extra space between the auth field and submit button at every viewport size', () => {
    expect(loginPageStyles).toMatch(/\.login-submit\s*\{[^}]*margin-top:\s*48px;/);
    expect(loginPageStyles).toMatch(/\.login-submit\s*\{\s*height:\s*46px;\s*margin-top:\s*30px;/);
    expect(loginPageStyles).toMatch(/\.login-submit\s*\{\s*margin-top:\s*31px;/);
  });

  it('shows the Studio loading state inside the return button', () => {
    const { container } = renderLogin({
      connecting: true,
      openingStudio: true,
      signedOut: true,
      authBusy: true,
      returningUserName: 'Alex Example',
    });

    const returnButton = screen.getByRole('button', { name: 'Opening Studio…' });
    expect(returnButton).toHaveAttribute('aria-busy', 'true');
    expect(returnButton).toHaveAttribute('aria-live', 'polite');
    expect(returnButton.querySelector('.login-returning-spinner')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.connection-spinner')).not.toBeInTheDocument();
    expect(screen.queryByText('Checking your connection…')).not.toBeInTheDocument();
  });

  it.each([false, true])('waits for hero fonts before revealing the login screen (Welcome Back: %s)', async (signedOut) => {
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    const resolveFontLoads: Array<() => void> = [];
    const load = vi.fn(() => new Promise<FontFace[]>((resolve) => {
      resolveFontLoads.push(() => resolve([]));
    }));
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });

    try {
      const { container } = renderLogin({ signedOut });
      await waitFor(() => expect(load).toHaveBeenCalledTimes(6));
      expect(container.querySelector('.auth-screen')).not.toHaveClass('is-login-fonts-ready');
      expect(load).toHaveBeenCalledWith(
        '700 23px "Orbitron"',
        expect.stringContaining('CONTINUE'),
      );
      expect(load).toHaveBeenCalledWith(
        '700 14px "Exo 2"',
        expect.any(String),
      );

      resolveFontLoads.forEach((resolve) => resolve());
      await waitFor(() => {
        expect(container.querySelector('.auth-screen')).toHaveClass('is-login-fonts-ready');
      });
    } finally {
      if (originalFonts) {
        Object.defineProperty(document, 'fonts', originalFonts);
      } else {
        Reflect.deleteProperty(document, 'fonts');
      }
    }
  });

  it('keeps the Welcome Back layout centered without shifting it during font loading', () => {
    expect(loginPageStyles).toMatch(
      /\.auth-screen\.is-returning \.login-layout\s*\{\s*animation:\s*none;/,
    );
    expect(loginPageStyles).toMatch(
      /\.auth-screen:not\(\.is-login-fonts-ready\) \.login-layout\s*\{\s*visibility:\s*hidden;/,
    );
    expect(loginPageStyles).toMatch(
      /\.auth-screen\.is-returning \.login-panel\s*\{\s*transition:\s*none;/,
    );
    expect(loginPageStyles).not.toMatch(/\.auth-screen\.is-returning \.login-layout\s*\{[^}]*transform:/);
    expect(loginPageStyles).toMatch(/\.login-panel\s*\{[^}]*align-self:\s*center;/);
  });

  it('uses a slightly stronger weight for the hero studio tagline on both auth screens', () => {
    expect(loginPageStyles).toMatch(/\.login-tagline span \+ span\s*\{[^}]*font-weight:\s*700;/);
  });

  it('keeps the disabled sign-in button legible in the light theme', () => {
    expect(loginPageStyles).toMatch(/html\[data-theme='light'\] \.login-submit:disabled\s*\{\s*color:\s*var\(--login-ink\);\s*opacity:\s*1;/);
  });

  it('uses a regular cursor while the submit button is disabled', () => {
    expect(loginPageStyles).toMatch(/\.login-submit:disabled\s*\{[^}]*cursor:\s*default;/);
  });

  it('keeps the start-over button close to submit with a dark default and muted hover color', () => {
    expect(loginPageStyles).toMatch(/\.login-back-slot\s*\{\s*height:\s*24px;/);
    expect(loginPageStyles).toMatch(/\.login-back-button\s*\{[^}]*height:\s*24px;[^}]*color:\s*var\(--login-ink\);/);
    expect(loginPageStyles).toMatch(/\.login-back-button:hover:not\(:disabled\)\s*\{[^}]*color:\s*var\(--login-muted\);/);
    expect(loginPageStyles).toMatch(/\.login-back-button:disabled,\s*\.login-back-button\[aria-disabled='true'\]\s*\{[^}]*cursor:\s*default;/);
    expect(loginPageStyles).toMatch(/\.login-back-slot\.is-visible \.login-back-button\[aria-disabled='true'\]\s*\{[^}]*pointer-events:\s*none;[^}]*cursor:\s*default !important;/);
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.login-back-button:hover:not\(:disabled\)\s*\{\s*color:\s*#e2e7eb;/);
  });

  it('uses the neighboring cool blue for the focused phone underline in dark theme', () => {
    expect(colorThemeStyles).toMatch(/html\[data-theme='dark'\] \.login-field-input:hover,\s*html\[data-theme='dark'\] \.login-field-input:focus,\s*html\[data-theme='dark'\] \.login-field-input:focus-visible\s*\{\s*border-bottom-color:\s*rgba\(35,\s*157,\s*251,\s*0\.45\);/);
  });

  it('sizes the divider to the hero text on both login and Welcome Back screens', () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('login-wordmark')) return new DOMRect(0, 100, 300, 100);
      if (this.classList.contains('login-tagline')) return new DOMRect(0, 220, 300, 60);
      if (this.classList.contains('login-divider')) return new DOMRect(0, 0, 32, 355);
      return new DOMRect(0, 0, 0, 0);
    });

    try {
      const loginScreen = renderLogin({ showAuthForm: true });
      const loginDivider = loginScreen.container.querySelector('.login-divider');
      expect(loginDivider).toBeInstanceOf(HTMLButtonElement);
      expect(loginDivider).toHaveStyle('--login-divider-line-top: 100px');
      expect(loginDivider).toHaveStyle('--login-divider-line-height: 180px');
      loginScreen.unmount();

      const { container } = renderLogin({ signedOut: true });
      const divider = container.querySelector('.login-divider');

      expect(divider).not.toBeInstanceOf(HTMLButtonElement);
      expect(divider).toHaveStyle('--login-divider-line-top: 100px');
      expect(divider).toHaveStyle('--login-divider-line-height: 180px');
    } finally {
      bounds.mockRestore();
    }
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

  it('preserves an in-progress code authorization when closing and reopening the form', () => {
    const { container } = renderToggleLogin({
      showAuthForm: true,
      authStep: 'code',
      phoneNumber: '+14155550123',
      phoneCode: '12345',
      authError: 'The code is incorrect.',
    });
    const toggleButton = container.querySelector('.login-divider')!;
    const form = container.querySelector('.login-form')!;

    expect(screen.getByLabelText('Login code')).toHaveValue('12345');
    fireEvent.click(toggleButton);
    expect(form).not.toHaveClass('is-visible');
    expect(toggleButton).toHaveAttribute('aria-label', 'Sign in');

    fireEvent.click(toggleButton);
    expect(form).toHaveClass('is-visible');
    expect(toggleButton).toHaveAttribute('aria-label', 'Close');
    expect(toggleButton).not.toHaveAttribute('data-tooltip');
    expect(toggleButton.querySelector('.login-button-tooltip')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Login code')).toHaveValue('12345');
    expect(screen.getByText('The code is incorrect.')).toBeInTheDocument();
  });

  it('closes the form when Telegram is clicked a second time', () => {
    const { container } = renderToggleLogin();
    const rowButton = screen.getByRole('button', { name: 'Continue with Telegram' });
    const telegramLabel = rowButton.querySelector('.login-method-label:last-child')!;
    const form = container.querySelector('.login-form');

    expect(rowButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(telegramLabel);
    expect(form).toHaveClass('is-visible');
    expect(rowButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(telegramLabel);
    expect(form).not.toHaveClass('is-visible');
    expect(rowButton).toHaveAttribute('aria-expanded', 'false');
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

  it('reserves the same start-over button space before and after the code step appears', () => {
    const { container, props, rerender } = renderLogin({ showAuthForm: true, authStep: 'phone' });
    const slot = container.querySelector('.login-back-slot');

    expect(slot).not.toHaveClass('is-visible');
    expect(screen.queryByRole('button', { name: 'Use a different phone number' })).not.toBeInTheDocument();

    rerender(
      <LocaleProvider>
        <LoginPage {...props} authStep="code" />
      </LocaleProvider>,
    );

    expect(container.querySelector('.login-back-slot')).toBe(slot);
    expect(slot).toHaveClass('is-visible');
    expect(screen.getByRole('button', { name: 'Use a different phone number' })).toBeInTheDocument();
  });

  it('updates the open form height when the auth step and message change', () => {
    const { container, props, rerender } = renderLogin({ showAuthForm: true, authStep: 'code' });
    const form = container.querySelector<HTMLFormElement>('.login-form')!;
    let measuredHeight = 180;
    Object.defineProperty(form, 'scrollHeight', {
      configurable: true,
      get: () => measuredHeight,
    });

    measuredHeight = 360;
    rerender(
      <LocaleProvider>
        <LoginPage
          {...props}
          authStep="password"
          authError="Enter your two-step verification password to continue."
          authNotice
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole('button', { name: 'Use a different phone number' })).toBeInTheDocument();
    expect(form.style.getPropertyValue('--login-form-open-height')).toBe('360px');
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

  it('signs out and returns to the initial registration screen from the saved-account screen', () => {
    const { container, props } = renderLogin({ signedOut: true, returningUserName: 'Alex Example', phoneNumber: '+14155550123' });
    const method = container.querySelector('.login-method');
    const messageSlot = container.querySelector('.login-error-slot');
    const startOver = screen.getByRole('button', { name: 'Sign out and start over' });

    expect(method?.nextElementSibling).toBe(messageSlot);
    expect(messageSlot?.nextElementSibling).toBe(startOver);

    fireEvent.click(startOver);

    expect(props.handleForgetAccount).toHaveBeenCalledOnce();
    expect(props.setShowAuthForm).not.toHaveBeenCalled();
    expect(props.setPhoneNumber).not.toHaveBeenCalled();
  });

  it.each(['code', 'password'] as const)('clears the previous phone number when restarting from %s entry', (authStep) => {
    const { container, props } = renderLogin({ showAuthForm: true, authStep, phoneNumber: '+14155550123' });

    fireEvent.click(container.querySelector('.login-back-button')!);

    expect(props.setAuthStep).toHaveBeenCalledWith('phone');
    expect(props.setPhoneNumber).toHaveBeenCalledWith('');
    expect(props.setPhoneCode).toHaveBeenCalledWith('');
    expect(props.setTwoFactorPassword).toHaveBeenCalledWith('');
  });

  it('prevents restarting while auth is busy without using the native disabled cursor', () => {
    const { container, props } = renderLogin({ showAuthForm: true, authStep: 'code', authBusy: true });
    const button = screen.getByRole('button', { name: 'Use a different phone number' });

    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(props.setAuthStep).not.toHaveBeenCalled();
    expect(props.setPhoneNumber).not.toHaveBeenCalled();
    expect(container.querySelector('.login-back-button[aria-disabled="true"]')).toBe(button);
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
    handleForgetAccount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}