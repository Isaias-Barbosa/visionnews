(function() {
  const usersStatus = document.getElementById('usersStatus');
  const refreshBtn = document.getElementById('refreshUsers');
  const usersList = document.getElementById('usersList');
  const usersCountNotice = document.getElementById('usersCountNotice');
  const userSearch = document.getElementById('userSearch');
  const filterBtns = document.querySelectorAll('.usersFilterBtn');
  
  const statTotal = document.getElementById('statTotal');
  const statEditors = document.getElementById('statEditors');
  const statVerified = document.getElementById('statVerified');

  const addUserForm = document.getElementById('addUserForm');
  const newEditorEmail = document.getElementById('newEditorEmail');
  const btnSubmitEditor = document.getElementById('btnSubmitEditor');
  const formFeedback = document.getElementById('formFeedback');

  let allUsers = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let isSaving = false;

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(d);
    } catch {
      return '—';
    }
  }

  function getInitials(name, email) {
    const base = (name || email || 'U').trim();
    const parts = base.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return base.slice(0, 2).toUpperCase();
  }

  async function loadUsers() {
    refreshBtn.disabled = true;
    usersStatus.textContent = 'Carregando lista de usuários…';
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao carregar usuários.');
      }
      
      allUsers = data.users || [];
      const stats = data.stats || {};

      statTotal.textContent = stats.total ?? allUsers.length;
      statEditors.textContent = (stats.editors ?? 0) + (stats.admins ?? 0);
      statVerified.textContent = stats.verified ?? 0;

      usersStatus.textContent = 'Banco de dados sincronizado · Horário de Brasília';
      renderList();
    } catch (err) {
      usersStatus.textContent = 'Erro: ' + err.message;
      usersList.innerHTML = `<p class="emptyList">Não foi possível carregar os usuários (${escapeHtml(err.message)}).</p>`;
      usersCountNotice.textContent = 'Erro ao consultar o banco.';
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function renderList() {
    const q = searchQuery.toLowerCase().trim();
    const filtered = allUsers.filter(u => {
      if (currentFilter !== 'all' && u.role !== currentFilter) {
        return false;
      }
      if (q) {
        const nameMatch = (u.name || '').toLowerCase().includes(q);
        const emailMatch = (u.email || '').toLowerCase().includes(q);
        return nameMatch || emailMatch;
      }
      return true;
    });

    usersCountNotice.textContent = `Mostrando ${filtered.length} de ${allUsers.length} ${allUsers.length === 1 ? 'usuário' : 'usuários'}`;

    if (!filtered.length) {
      usersList.innerHTML = `
        <div class="emptyList">
          <p>Nenhum usuário encontrado com os filtros selecionados.</p>
        </div>
      `;
      return;
    }

    usersList.innerHTML = filtered.map(u => {
      const initials = getInitials(u.name, u.email);
      const isVerified = Boolean(u.emailVerified);
      const role = u.role || 'user';
      
      let roleLabel = 'Leitor';
      let roleClass = 'roleUser';
      if (role === 'admin') {
        roleLabel = 'Administrador';
        roleClass = 'roleAdmin';
      } else if (role === 'editor') {
        roleLabel = 'Editor';
        roleClass = 'roleEditor';
      }

      const roleBadge = `<span class="userBadge ${roleClass}">${roleLabel}</span>`;
      const verifyBadge = isVerified
        ? `<span class="verifyPill verified" title="E-mail verificado">✓ Verificado</span>`
        : `<span class="verifyPill pending" title="Confirmação de e-mail pendente">○ Não verificado</span>`;

      let actionHtml = '';
      if (role === 'admin') {
        actionHtml = `<span class="fieldHint" style="margin:0">Gerenciado na hospedagem</span>`;
      } else if (role === 'editor') {
        actionHtml = `
          <button type="button" class="outlineButton btnActionRole" data-email="${escapeHtml(u.email)}" data-action="remove" title="Remover da equipe editorial">
            Revogar editor
          </button>
        `;
      } else {
        actionHtml = `
          <button type="button" class="outlineButton btnActionRole btnPromote" data-email="${escapeHtml(u.email)}" data-action="promote" title="Conceder acesso editorial">
            Tornar editor
          </button>
        `;
      }

      return `
        <article class="userCard">
          <div class="userCardMain">
            <div class="userAvatar" aria-hidden="true">${escapeHtml(initials)}</div>
            <div class="userInfo">
              <div class="userHeader">
                <h3 class="userName">${escapeHtml(u.name || 'Usuário')}</h3>
                <div class="userBadges">
                  ${roleBadge}
                  ${verifyBadge}
                </div>
              </div>
              <p class="userEmail">${escapeHtml(u.email)}</p>
              <div class="userMeta">
                <span>Cadastrado em: ${escapeHtml(formatDate(u.createdAt))}</span>
              </div>
            </div>
          </div>
          <div class="userCardActions">
            ${actionHtml}
          </div>
        </article>
      `;
    }).join('');

    // Adiciona handlers para os botões de ação
    usersList.querySelectorAll('.btnActionRole').forEach(btn => {
      btn.addEventListener('click', async () => {
        const email = btn.dataset.email;
        const action = btn.dataset.action;
        await handleRoleChange(email, action);
      });
    });
  }

  async function handleRoleChange(email, action) {
    if (isSaving) return;
    const isPromote = action === 'promote';
    const confirmMsg = isPromote
      ? `Deseja autorizar o usuário "${email}" como EDITOR da redação?`
      : `Deseja remover as permissões de editor do usuário "${email}"?`;

    if (!confirm(confirmMsg)) return;

    isSaving = true;
    usersStatus.textContent = 'Atualizando permissões…';
    try {
      const res = await fetch('/api/admin/editors', {
        method: isPromote ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao atualizar papel.');

      usersStatus.textContent = isPromote
        ? `Acesso editorial concedido a ${email}.`
        : `Acesso editorial revogado de ${email}.`;
      await loadUsers();
    } catch (err) {
      usersStatus.textContent = 'Erro: ' + err.message;
      alert('Erro ao alterar permissão: ' + err.message);
    } finally {
      isSaving = false;
    }
  }

  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSaving) return;
    const email = newEditorEmail.value.trim().toLowerCase();
    if (!email) return;

    isSaving = true;
    btnSubmitEditor.disabled = true;
    formFeedback.textContent = 'Autorizando novo editor…';

    try {
      const res = await fetch('/api/admin/editors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível autorizar o editor.');

      formFeedback.textContent = `Editor "${email}" autorizado com sucesso!`;
      addUserForm.reset();
      await loadUsers();
    } catch (err) {
      formFeedback.textContent = 'Erro: ' + err.message;
    } finally {
      isSaving = false;
      btnSubmitEditor.disabled = false;
    }
  });

  userSearch.addEventListener('input', () => {
    searchQuery = userSearch.value;
    renderList();
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      currentFilter = btn.dataset.role;
      renderList();
    });
  });

  refreshBtn.addEventListener('click', loadUsers);

  // Inicialização
  loadUsers();
})();
