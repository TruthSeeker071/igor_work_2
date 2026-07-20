/**
 * Portal home target-career picker — click-to-toggle dropdown wired to O*NET ranks.
 */
(function (global) {
  var instance = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatFit(score) {
    if (!Number.isFinite(score)) return '';
    if (global.FWCareerTarget && typeof FWCareerTarget.formatFitPercent === 'function') {
      return FWCareerTarget.formatFitPercent(score);
    }
    return Math.round(score) + '%';
  }

  function rankPending() {
    if (!global.FWOnetVectors) return false;
    if (FWOnetVectors.getCachedOnetRank && FWOnetVectors.getCachedOnetRank(1)) return false;
    if (FWOnetVectors.getCachedFeaturedRank && FWOnetVectors.getCachedFeaturedRank(1)) return false;
    return true;
  }

  function hubLinkHref(soc) {
    return soc ? 'dashboard.html?soc=' + encodeURIComponent(soc) : 'dashboard.html';
  }

  function clientPortalVectorFit(soc) {
    if (!soc || !global.FWOnetVectors || !global.FWOnetMath) return Promise.resolve(null);
    return Promise.all([
      FWOnetVectors.resolvePersonality({}),
      FWOnetVectors.fetchVectorsBatched([soc]),
    ]).then(function (parts) {
      var personality = parts[0];
      var vectors = parts[1] || {};
      var careerVec = vectors[soc];
      var objective = FWOnetVectors.readQuizVectors().objective;
      if (!personality || !careerVec) return null;
      var M = FWOnetMath;
      var entry = { personalityFit: M.cosinePercent(M.cosine(personality.values, careerVec)) };
      if (objective && objective.values && FWOnetVectors.magnitude(objective.values) > 0.01) {
        entry.objectiveFit = M.objectiveFitPercent
          ? M.objectiveFitPercent(objective.values, careerVec)
          : M.cosinePercent(M.cosine(objective.values, careerVec));
        if (typeof FWOnetVectors.computePreparedness === 'function') {
          entry.preparedness = FWOnetVectors.computePreparedness(objective.values, careerVec, {});
        }
      }
      return entry.personalityFit != null ? entry : null;
    }).catch(function () { return null; });
  }

  function resolveSocForTarget(target) {
    if (!target || !global.FWOnetVectors) return Promise.resolve(null);
    if (target.soc) return Promise.resolve(target.soc);
    if (!target.slug || typeof FWOnetVectors.resolveSocForSlug !== 'function') {
      return Promise.resolve(null);
    }
    return FWOnetVectors.resolveSocForSlug(target.slug);
  }

  function fetchPortalVectorFit(soc) {
    if (!soc) return Promise.resolve(null);
    if (global.FWAuth && FWAuth.authEmail && FWAuth.authEmail()
      && global.FWOnetVectors && typeof FWOnetVectors.fetchAuthenticatedVectorFit === 'function') {
      return FWOnetVectors.fetchAuthenticatedVectorFit(soc)
        .then(function (vf) {
          if (vf && vf.personalityFit != null) return vf;
          return clientPortalVectorFit(soc);
        });
    }
    return clientPortalVectorFit(soc);
  }

  function renderDualFitLoadingHtml() {
    return '<div class="portal-target-dual-fit-loading" aria-busy="true">'
      + '<div class="fw-skeleton portal-target-dual-fit-skeleton"></div>'
      + '<div class="fw-skeleton portal-target-dual-fit-skeleton portal-target-dual-fit-skeleton--short"></div>'
      + '</div>';
  }

  function renderDualFitErrorHtml() {
    return '<p class="portal-target-dual-fit-error">Fit details unavailable — <a href="dashboard.html">open Career Hub</a></p>';
  }

  function TargetSwitch(root, opts) {
    this.root = root;
    this.opts = opts || {};
    this.open = false;
    this.loading = false;
    this.bound = false;
    this.searchQuery = '';
    this.searchResults = null;

    this.row = null;
    this.picker = null;
    this.toggle = null;
    this.menu = null;
    this.dualFit = null;
    this.advisorSlot = null;

    this.onDocClick = this.onDocClick.bind(this);
    this.onDocKeydown = this.onDocKeydown.bind(this);
  }

  TargetSwitch.prototype.shouldShow = function (data) {
    var hasQuiz = data && data.scores && Object.keys(data.scores).length;
    var signedIn = !!(global.FWAuth && FWAuth.authEmail && FWAuth.authEmail());
    return !!(hasQuiz && signedIn && global.FWCareerTarget && FWCareerTarget.resolveTargetCareer());
  };

  TargetSwitch.prototype.buildShell = function () {
    this.root.innerHTML = ''
      + '<div class="portal-target-row" id="portal-target-row">'
      + '<div class="portal-target-controls">'
      + '<div class="portal-target-picker">'
      + '<div class="portal-target-main">'
      + '<div class="portal-target-label">Target career</div>'
      + '<button type="button" class="portal-target-btn" id="portal-target-toggle" aria-haspopup="listbox" aria-expanded="false">'
      + '<span class="portal-target-orb" aria-hidden="true"></span>'
      + '<span class="portal-target-name"></span>'
      + '<span class="portal-target-fit"></span>'
      + '<span class="portal-target-chevron" aria-hidden="true">▾</span>'
      + '</button>'
      + '</div>'
      + '<div class="portal-target-menu" id="portal-target-menu" hidden role="listbox" aria-label="Career matches"></div>'
      + '</div>'
      + '<div id="portal-target-advisor-slot"></div>'
      + '</div>'
      + '<div class="portal-target-metrics portal-target-dual-fit" id="portal-target-dual-fit" hidden aria-live="polite"></div>'
      + '<div class="portal-target-cta-row"><a class="portal-target-deepdive" id="portal-target-deepdive" href="career.html">Open deep dive &rarr;</a></div>'
      + '</div>';

    this.row = this.root.querySelector('#portal-target-row');
    this.picker = this.root.querySelector('.portal-target-picker');
    this.toggle = this.root.querySelector('#portal-target-toggle');
    this.menu = this.root.querySelector('#portal-target-menu');
    this.dualFit = this.root.querySelector('#portal-target-dual-fit');
    this.advisorSlot = this.root.querySelector('#portal-target-advisor-slot');
  };

  TargetSwitch.prototype.bind = function () {
    if (this.bound) return;
    this.bound = true;
    document.addEventListener('click', this.onDocClick);
    document.addEventListener('keydown', this.onDocKeydown);
  };

  TargetSwitch.prototype.unbind = function () {
    if (!this.bound) return;
    this.bound = false;
    document.removeEventListener('click', this.onDocClick);
    document.removeEventListener('keydown', this.onDocKeydown);
  };

  TargetSwitch.prototype.isOpen = function () {
    return this.open;
  };

  TargetSwitch.prototype.close = function () {
    if (this.picker) this.picker.classList.remove('portal-target-picker--open');
    if (!this.open) return;
    this.open = false;
    this.searchQuery = '';
    this.searchResults = null;
    if (this.menu) this.menu.hidden = true;
    if (this.toggle) this.toggle.setAttribute('aria-expanded', 'false');
  };

  TargetSwitch.prototype.openMenu = function () {
    this.open = true;
    if (this.picker) this.picker.classList.add('portal-target-picker--open');
    if (this.menu) this.menu.hidden = false;
    if (this.toggle) this.toggle.setAttribute('aria-expanded', 'true');
  };

  TargetSwitch.prototype.onDocClick = function (e) {
    if (!this.picker || !this.root || !this.root.isConnected) return;

    var toggle = e.target.closest('#portal-target-toggle');
    if (toggle && this.picker.contains(toggle)) {
      e.stopPropagation();
      if (this.loading) return;
      if (this.open) this.close();
      else this.openMenu();
      return;
    }

    var opt = e.target.closest('.portal-target-option');
    if (opt && this.menu && this.menu.contains(opt)) {
      e.stopPropagation();
      this.selectCareer(
        opt.getAttribute('data-slug'),
        opt.getAttribute('data-name'),
        opt.getAttribute('data-soc')
      );
      return;
    }

    if (this.menu && this.menu.contains(e.target)) {
      e.stopPropagation();
      return;
    }

    if (this.open) this.close();
  };

  TargetSwitch.prototype.onDocKeydown = function (e) {
    if (e.key === 'Escape' && this.open) this.close();
  };

  TargetSwitch.prototype.isOptionSelected = function (m, target) {
    if (!target || !m) return false;
    if (m.slug === target.slug) return true;
    if (m.soc && target.soc && m.soc === target.soc) return true;
    if (global.FWCareerTarget && typeof FWCareerTarget.normalizeSlug === 'function') {
      return FWCareerTarget.normalizeSlug(m.slug) === FWCareerTarget.normalizeSlug(target.slug);
    }
    return false;
  };

  TargetSwitch.prototype.catalogMatches = function (query, limit) {
    if (!query || !global.FWOnetCatalog || typeof FWOnetCatalog.searchByTitle !== 'function') {
      return [];
    }
    var hits = FWOnetCatalog.searchByTitle(query, limit || 10);
    return hits.map(function (hit) {
      var rarity = { tier: 'common', base: '#9AA0AD' };
      if (global.FWCareerTarget && typeof FWCareerTarget.fitRarity === 'function') {
        rarity = FWCareerTarget.fitRarity(50);
      }
      return {
        id: hit.soc ? ('soc:' + hit.soc) : hit.slug,
        soc: hit.soc || null,
        name: hit.name,
        score: null,
        slug: hit.slug,
        rarity: rarity,
      };
    });
  };

  TargetSwitch.prototype.renderMenuHtml = function (list, target) {
    var self = this;
    var searchHtml = '<div class="portal-target-search-wrap">'
      + '<input type="search" class="portal-target-search" id="portal-target-search" '
      + 'placeholder="Search all careers…" autocomplete="off" aria-label="Search careers" '
      + 'value="' + esc(this.searchQuery) + '" />'
      + '</div>';
    var html = searchHtml + (list || []).map(function (m) {
      var selected = self.isOptionSelected(m, target) ? ' portal-target-option--selected' : '';
      var fitLabel = formatFit(m.score);
      var orbColor = (m.rarity && m.rarity.base) ? m.rarity.base : '#9AA0AD';
      var socAttr = m.soc ? ' data-soc="' + esc(m.soc) + '"' : '';
      return '<button type="button" class="portal-target-option' + selected + '" role="option" data-slug="' + esc(m.slug) + '" data-name="' + esc(m.name) + '"' + socAttr + '>'
        + '<span class="portal-target-orb portal-target-orb--sm" style="background:' + esc(orbColor) + '"></span>'
        + '<span class="portal-target-option-name">' + esc(m.name) + '</span>'
        + '<span class="portal-target-option-fit">' + esc(fitLabel) + '</span>'
        + (selected ? '<span class="portal-target-check" aria-hidden="true">✓</span>' : '')
        + '</button>';
    }).join('');
    if (this.searchQuery && (!list || !list.length)) {
      html += '<p class="portal-target-search-empty">No careers match “' + esc(this.searchQuery) + '”</p>';
    }
    var hubSoc = (target && target.soc) || ((list && list[0] && list[0].soc) ? list[0].soc : '');
    html += '<a class="portal-target-hub-link" href="' + esc(hubLinkHref(hubSoc)) + '">See all in Career Hub →</a>';
    return html;
  };

  TargetSwitch.prototype.showError = function (message) {
    if (!this.row) return;
    var err = this.row.querySelector('.portal-target-switch-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'portal-target-switch-error';
      err.setAttribute('role', 'alert');
      this.row.appendChild(err);
    }
    err.textContent = message;
    setTimeout(function () {
      if (err && err.parentNode) err.parentNode.removeChild(err);
    }, 4200);
  };

  TargetSwitch.prototype.setLoading = function (loading) {
    this.loading = !!loading;
    if (!this.row) return;
    this.row.classList.toggle('portal-target--loading', this.loading);
  };

  TargetSwitch.prototype.updateHero = function (target) {
    if (!this.toggle || !target) return;
    var dd = this.root && this.root.querySelector('#portal-target-deepdive');
    if (dd && target.slug) dd.href = 'career.html?slug=' + encodeURIComponent(target.slug);
    var orb = this.toggle.querySelector('.portal-target-orb');
    var nameEl = this.toggle.querySelector('.portal-target-name');
    var fitEl = this.toggle.querySelector('.portal-target-fit');
    if (orb && target.rarity) orb.style.background = target.rarity.base;
    if (nameEl) {
      nameEl.textContent = target.name || '';
      nameEl.title = target.name || '';
    }
    if (fitEl) {
      var fitLabel = formatFit(target.score);
      fitEl.textContent = fitLabel || (rankPending() ? '…' : '');
    }
    if (this.row) {
      this.row.classList.toggle('portal-target--rank-pending', !formatFit(target.score) && rankPending());
    }
  };

  TargetSwitch.prototype.hydrateHeroScore = function (target) {
    var self = this;
    if (!target || !this.toggle) return;
    if (Number.isFinite(target.score)) {
      this.updateHero(target);
      return;
    }
    if (!target.slug || !global.FWCareerTarget
      || typeof FWCareerTarget.resolveSlugFit !== 'function') {
      this.updateHero(target);
      return;
    }
    FWCareerTarget.resolveSlugFit(target.slug).then(function (fit) {
      if (fit == null) return;
      var fitEl = self.toggle.querySelector('.portal-target-fit');
      if (fitEl) fitEl.textContent = formatFit(fit);
      if (self.row) self.row.classList.remove('portal-target--rank-pending');
    }).catch(function () {
      if (self.row) self.row.classList.remove('portal-target--rank-pending');
    });
  };

  TargetSwitch.prototype.hydrateDualFit = function (target) {
    var self = this;
    if (!this.dualFit || !target || !target.slug || !global.FWOnetVectors) {
      if (this.dualFit) this.dualFit.hidden = true;
      return;
    }
    var requestId = (this.dualFitRequestId || 0) + 1;
    this.dualFitRequestId = requestId;
    this.dualFit.hidden = false;
    this.dualFit.innerHTML = renderDualFitLoadingHtml();

    resolveSocForTarget(target).then(function (soc) {
      if (requestId !== self.dualFitRequestId) return null;
      if (!soc) return { error: true };
      return fetchPortalVectorFit(soc);
    }).then(function (vf) {
      if (requestId !== self.dualFitRequestId) return;
      if (!vf || vf.error || vf.personalityFit == null || !FWOnetVectors.renderDualFitBarsHtml) {
        self.dualFit.innerHTML = renderDualFitErrorHtml();
        self.dualFit.hidden = false;
        return;
      }
      self.dualFit.innerHTML = FWOnetVectors.renderDualFitBarsHtml(vf.personalityFit, vf.objectiveFit, {
        preparedness: vf.preparedness,
      });
      self.dualFit.hidden = false;
    }).catch(function () {
      if (requestId !== self.dualFitRequestId) return;
      self.dualFit.innerHTML = renderDualFitErrorHtml();
      self.dualFit.hidden = false;
    });
  };

  TargetSwitch.prototype.mountAdvisor = function () {
    if (!this.advisorSlot || !global.FWPortalCareerAdvisor
      || typeof FWPortalCareerAdvisor.mount !== 'function') return;
    FWPortalCareerAdvisor.mount(this.advisorSlot);
  };

  TargetSwitch.prototype.bindMenuSearch = function () {
    var self = this;
    if (!this.menu || this.menu._fwSearchBound) return;
    this.menu._fwSearchBound = true;
    this.menu.addEventListener('input', function (e) {
      var input = e.target.closest('#portal-target-search');
      if (!input) return;
      self.searchQuery = (input.value || '').trim();
      var target = self.lastTarget;
      var list;
      if (self.searchQuery.length >= 2) {
        if (global.FWOnetCatalog && typeof FWOnetCatalog.load === 'function') {
          FWOnetCatalog.load().then(function () {
            self.searchResults = self.catalogMatches(self.searchQuery, 10);
            self.updateMenu(self.searchResults, target);
          });
          return;
        }
        self.searchResults = self.catalogMatches(self.searchQuery, 10);
        list = self.searchResults;
      } else {
        self.searchResults = null;
        list = self.lastMatches || [];
      }
      self.updateMenu(list, target);
    });
  };

  TargetSwitch.prototype.updateMenu = function (list, target) {
    if (!this.menu) return;
    var wasOpen = this.open;
    this.menu.innerHTML = this.renderMenuHtml(list, target);
    this.bindMenuSearch();
    if (wasOpen) {
      this.menu.hidden = false;
      if (this.toggle) this.toggle.setAttribute('aria-expanded', 'true');
      if (this.picker) this.picker.classList.add('portal-target-picker--open');
      var search = this.menu.querySelector('#portal-target-search');
      if (search && this.searchQuery) {
        search.focus();
        try {
          search.setSelectionRange(search.value.length, search.value.length);
        } catch (_) { /* ignore */ }
      }
    }
  };

  TargetSwitch.prototype.update = function (state) {
    state = state || {};
    var data = state.data;
    if (data && !this.shouldShow(data)) {
      this.root.innerHTML = '';
      this.row = null;
      this.close();
      return;
    }
    if (!this.row) {
      this.buildShell();
      this.bind();
    }
    if (!global.FWCareerTarget) return;

    var target = state.target || FWCareerTarget.resolveTargetCareer();
    var matches = state.matches || FWCareerTarget.rankedCareerMatches(12);
    this.lastTarget = target;
    this.lastMatches = matches;
    if (!target) {
      this.root.innerHTML = '';
      this.row = null;
      return;
    }

    this.updateHero(target);
    var menuList = this.searchQuery && this.searchResults ? this.searchResults : matches;
    this.updateMenu(menuList, target);
    this.hydrateHeroScore(target);
    this.hydrateDualFit(target);
    this.mountAdvisor();

    if (typeof this.opts.onUpdated === 'function') {
      this.opts.onUpdated({ target: target, matches: matches });
    }
  };

  TargetSwitch.prototype.selectCareer = function (slug, name, soc) {
    var self = this;
    if (!name || !global.FWCareerTarget) return;
    if (!slug) {
      this.showError('Could not switch — career link missing.');
      return;
    }
    this.close();
    this.setLoading(true);
    FWCareerTarget.switchTargetCareer({
      slug: slug,
      name: name,
      soc: soc || null,
      source: 'home_dropdown',
    }).catch(function (err) {
      console.warn('career switch failed', err);
    }).finally(function () {
      self.setLoading(false);
      if (typeof self.opts.onSwitched === 'function') {
        self.opts.onSwitched();
      }
    });
  };

  TargetSwitch.prototype.destroy = function () {
    this.close();
    this.unbind();
    if (this.root) this.root.innerHTML = '';
    this.row = null;
    this.picker = null;
    this.toggle = null;
    this.menu = null;
    this.dualFit = null;
    this.advisorSlot = null;
  };

  function getOrCreate(slotEl, opts) {
    if (!slotEl) return null;
    if (!instance || instance.root !== slotEl) {
      if (instance) instance.destroy();
      instance = new TargetSwitch(slotEl, opts);
    } else if (opts) {
      instance.opts = Object.assign({}, instance.opts, opts);
    }
    return instance;
  }

  global.FWPortalTargetSwitch = {
    mount: function (slotEl, opts) {
      var ctrl = getOrCreate(slotEl, opts);
      if (!ctrl) return null;
      ctrl.update({ data: opts && opts.data });
      return ctrl;
    },
    update: function (state) {
      if (!instance) return null;
      instance.update(state);
      return instance;
    },
    close: function () {
      if (instance) instance.close();
    },
    isOpen: function () {
      return !!(instance && instance.isOpen());
    },
    destroy: function () {
      if (instance) {
        instance.destroy();
        instance = null;
      }
    },
    showError: function (message) {
      if (instance) instance.showError(message);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
