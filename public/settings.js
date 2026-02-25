(async () => {
  const $org = document.getElementById('org');
  const $project = document.getElementById('project');
  const $pat = document.getElementById('pat');
  const $save = document.getElementById('save');
  const $cancel = document.getElementById('cancel');
  const $btnShow = document.getElementById('btn-show');
  const $btnCopy = document.getElementById('btn-copy');
  const $spinner = document.getElementById('spinner');
  const $msgSuccess = document.getElementById('msg-success');
  const $msg = document.getElementById('msg');

  // try to prefill from stored creds (only available in Electron)
  if (window.electronAPI && window.electronAPI.getCredentials) {
    try {
      const existing = await window.electronAPI.getCredentials();
      if (existing) {
        $org.value = existing.AZDO_ORG || '';
        $project.value = existing.AZDO_PROJECT || '';
        // don't prefill PAT for security
      }
    } catch (e) {
      console.warn('Could not read stored credentials', e);
    }
  } else {
    // Not running inside Electron; show a helpful message
    $msg.textContent = 'La configuración sólo está disponible dentro de la aplicación de escritorio.';
    $msg.classList.remove('hidden');
  }

  $btnShow?.addEventListener('click', () => {
    if ($pat.type === 'password') { $pat.type = 'text'; $btnShow.textContent = 'Ocultar'; }
    else { $pat.type = 'password'; $btnShow.textContent = 'Mostrar'; }
  });

  $btnCopy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($pat.value || '');
      $msg.textContent = 'Token copiado al portapapeles';
      $msg.classList.remove('hidden');
      setTimeout(() => $msg.classList.add('hidden'), 2000);
    } catch (e) {
      $msg.textContent = 'No se pudo copiar: ' + (e && e.message ? e.message : e);
      $msg.classList.remove('hidden');
    }
  });

  $save.addEventListener('click', async () => {
    const org = $org.value.trim();
    const project = $project.value.trim();
    const pat = $pat.value.trim();
    if (!org || !project || !pat) {
      $msg.textContent = 'Todos los campos son obligatorios';
      $msg.classList.remove('hidden');
      return;
    }
    $msg.classList.add('hidden');
    $msgSuccess.classList.add('hidden');
    $save.disabled = true; $cancel.disabled = true;
    $spinner.classList.remove('hidden');
    try {
      const res = await window.electronAPI.saveCredentials({ AZDO_ORG: org, AZDO_PROJECT: project, AZDO_PAT: pat });
      $msgSuccess.classList.remove('hidden');
      setTimeout(() => { try { window.close(); } catch(e){} }, 700);
    } catch (err) {
      $msg.textContent = 'Error guardando credenciales: ' + (err && err.message ? err.message : err);
      $msg.classList.remove('hidden');
      $save.disabled = false; $cancel.disabled = false;
    } finally {
      $spinner.classList.add('hidden');
    }
  });

  $cancel.addEventListener('click', () => window.close());
})();
