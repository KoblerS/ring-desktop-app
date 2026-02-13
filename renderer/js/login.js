// Login page logic
const loginForm = document.getElementById('login-form');
const twoFactorSection = document.getElementById('two-factor-section');
const twoFactorForm = document.getElementById('two-factor-form');
const errorMessage = document.getElementById('error-message');
const loginBtn = document.getElementById('login-btn');
const verifyBtn = document.getElementById('verify-btn');
const backBtn = document.getElementById('back-btn');
const codeInputs = document.querySelectorAll('.code-input input');

let userEmail = '';
let userPassword = '';

// Show error message
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('visible');
}

// Hide error message
function hideError() {
  errorMessage.classList.remove('visible');
}

// Set button loading state
function setButtonLoading(button, loading, originalText = 'Sign In') {
  if (loading) {
    button.disabled = true;
    button.innerHTML = `<div class="spinner"></div> Loading...`;
  } else {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

// Show 2FA section
function showTwoFactor() {
  loginForm.style.display = 'none';
  twoFactorSection.classList.add('visible');
  codeInputs[0].focus();
}

// Hide 2FA section
function hideTwoFactor() {
  twoFactorSection.classList.remove('visible');
  loginForm.style.display = 'block';
  codeInputs.forEach(input => input.value = '');
}

// Handle login form submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  userEmail = document.getElementById('email').value.trim();
  userPassword = document.getElementById('password').value;

  if (!userEmail || !userPassword) {
    showError('Please enter your email and password.');
    return;
  }

  setButtonLoading(loginBtn, true);

  try {
    const result = await window.ringAPI.login(userEmail, userPassword);
    
    if (result.success) {
      // Login successful without 2FA - redirect to dashboard
      window.location.href = 'dashboard.html';
    } else if (result.requiresTwoFactor) {
      // 2FA required
      showTwoFactor();
    } else {
      showError(result.error || 'Login failed. Please check your credentials.');
    }
  } catch (error) {
    showError('An unexpected error occurred. Please try again.');
    console.error('Login error:', error);
  } finally {
    setButtonLoading(loginBtn, false, 'Sign In');
  }
});

// Handle 2FA code input
codeInputs.forEach((input, index) => {
  // Focus next input on entry
  input.addEventListener('input', (e) => {
    const value = e.target.value;
    
    // Only allow numbers
    if (!/^\d*$/.test(value)) {
      e.target.value = '';
      return;
    }

    if (value && index < codeInputs.length - 1) {
      codeInputs[index + 1].focus();
    }

    // Auto-submit if all fields are filled
    const code = getVerificationCode();
    if (code.length === 6) {
      twoFactorForm.dispatchEvent(new Event('submit'));
    }
  });

  // Handle backspace
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && index > 0) {
      codeInputs[index - 1].focus();
    }
  });

  // Handle paste
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    
    pastedData.split('').forEach((char, i) => {
      if (codeInputs[i]) {
        codeInputs[i].value = char;
      }
    });

    // Focus last filled input or submit
    const lastIndex = Math.min(pastedData.length - 1, 5);
    if (lastIndex >= 0) {
      codeInputs[lastIndex].focus();
    }
    
    if (pastedData.length === 6) {
      twoFactorForm.dispatchEvent(new Event('submit'));
    }
  });
});

// Get verification code from inputs
function getVerificationCode() {
  return Array.from(codeInputs).map(input => input.value).join('');
}

// Handle 2FA form submission
twoFactorForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const code = getVerificationCode();
  
  if (code.length !== 6) {
    showError('Please enter the complete 6-digit code.');
    return;
  }

  setButtonLoading(verifyBtn, true, 'Verify Code');

  try {
    const result = await window.ringAPI.verifyTwoFactor(userEmail, userPassword, code);
    
    if (result.success) {
      // Verification successful - redirect to dashboard
      window.location.href = 'dashboard.html';
    } else {
      showError(result.error || 'Invalid verification code. Please try again.');
      codeInputs.forEach(input => input.value = '');
      codeInputs[0].focus();
    }
  } catch (error) {
    showError('An unexpected error occurred. Please try again.');
    console.error('2FA error:', error);
  } finally {
    setButtonLoading(verifyBtn, false, 'Verify Code');
  }
});

// Handle back button
backBtn.addEventListener('click', () => {
  hideError();
  hideTwoFactor();
});
