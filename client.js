/**
 * Client half of the "DSH style" bundle.
 *
 * Registers three things on the page:
 *   - `settings.section` + `settings.section.icon` — the "DSH style" page;
 *   - `sidebar.brand.name` / `sidebar.brand.mark` — the custom top-left name
 *     and logo, registered at a lower priority than the shipped occupant so
 *     they shadow it only while a value is configured;
 *   - one stylesheet plus a theme token layer that turns the configured image
 *     into the window wallpaper.
 *
 * All state comes from the Host route owned by `index.js`; the settings page
 * writes through the same route.
 *
 * @module dsh-style-wallpaper/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-style-wallpaper',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace and asset/route prefix. */
    const NS = 'dsh-style';
    const BASE = '/dsh-style';
    /**
     * Slots of kind `single` reject a second registration at the same priority
     * and render the lowest priority, so one step below the shipped occupant
     * shadows it and disposing the registration restores it.
     */
    const SHADOW_PRIORITY = -1;
    /** Ceilings mirrored from the Host half, used for an early UI refusal only. */
    const LIMITS = { logo: 2 * 1024 * 1024, background: 32 * 1024 * 1024 };

    const zh = {
      'section.title': 'DSH 样式',
      'section.desc': '自定义左上角的名称与图标，并用一张图片铺满整个窗口作为背景。',
      'name.label': '应用名称',
      'name.hint': '显示在左上角。留空则使用默认名称。',
      'name.placeholder': '输入名称',
      'name.save': '应用',
      'name.reset': '恢复默认',
      'logo.label': '应用图标',
      'logo.hint': '显示在名称左侧，建议使用正方形。支持 PNG、JPG、WebP、GIF、SVG。',
      'logo.upload': '上传图标',
      'logo.reset': '恢复默认',
      'background.label': '背景图',
      'background.hint': '铺满整个窗口，支持 PNG、JPG、WebP、GIF 等动图；视频暂不支持。',
      'background.upload': '上传背景',
      'background.remove': '移除背景',
      'background.dim': '背景遮罩',
      'background.dimHint': '数值越大背景越暗，文字越清楚。',
      'empty': '未设置',
      'loading': '加载中…',
      'loadFailed': '配置加载失败，请重试。',
      'retry': '重试',
      'saved': '已保存',
      'failed': '操作失败，请重试。',
      'tooLarge': '文件过大：图标上限 2 MB，背景上限 32 MB。',
      'unsupported': '不支持的文件格式，请使用图片。',
      'video': '暂不支持视频，请使用图片或动图（GIF / WebP）。',
      'busy': '处理中…',
    };

    const en = {
      'section.title': 'DSH style',
      'section.desc': 'Customize the top-left name and icon, and use an image as the window wallpaper.',
      'name.label': 'App name',
      'name.hint': 'Shown at the top left. Leave empty to keep the default name.',
      'name.placeholder': 'Enter a name',
      'name.save': 'Apply',
      'name.reset': 'Restore default',
      'logo.label': 'App icon',
      'logo.hint': 'Shown left of the name; a square image works best. PNG, JPG, WebP, GIF, and SVG are supported.',
      'logo.upload': 'Upload icon',
      'logo.reset': 'Restore default',
      'background.label': 'Wallpaper',
      'background.hint': 'Covers the whole window. PNG, JPG, WebP, and animated GIF are supported; video is not.',
      'background.upload': 'Upload wallpaper',
      'background.remove': 'Remove wallpaper',
      'background.dim': 'Wallpaper veil',
      'background.dimHint': 'Higher values darken the wallpaper and improve text contrast.',
      'empty': 'Not set',
      'loading': 'Loading…',
      'loadFailed': 'Could not load the settings. Please retry.',
      'retry': 'Retry',
      'saved': 'Saved',
      'failed': 'Something went wrong. Please retry.',
      'tooLarge': 'File is too large: 2 MB for the icon, 32 MB for the wallpaper.',
      'unsupported': 'Unsupported file type. Please use an image.',
      'video': 'Video is not supported; please use an image or an animated GIF or WebP.',
      'busy': 'Working…',
    };

    /** Shared appearance store. Module-level so an HMR re-apply keeps the values. */
    let snapshot = null;
    let loadFailed = false;
    let revision = 0;
    const listeners = new Set();
    const getRevision = () => revision;

    function bump() {
      revision += 1;
      for (const listener of Array.from(listeners)) {
        try {
          listener();
        } catch (error) {
          console.error('[dsh-style] store listener failed', error);
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    function publish(state) {
      snapshot = state;
      loadFailed = false;
      bump();
    }

    /** One submit in flight at a time; the page disables its controls meanwhile. */
    let loading = null;

    function refresh() {
      if (loading !== null) return loading;
      loading = (async () => {
        try {
          const payload = await call('/state', { method: 'GET' });
          if (payload?.ok !== true) loadFailed = true;
        } catch {
          loadFailed = true;
        } finally {
          loading = null;
          bump();
        }
      })();
      return loading;
    }

    /**
     * Talk to the Host route and republish any returned state.
     *
     * @param path - route suffix after `/dsh-style`.
     * @param init - fetch options.
     * @returns the parsed JSON payload, or null for a non-JSON response.
     */
    async function call(path, init) {
      const response = await fetch(`${BASE}${path}`, { cache: 'no-store', ...init });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (payload !== null && typeof payload === 'object' && payload.ok === true && payload.state !== undefined) {
        publish(payload.state);
      }
      return payload;
    }

    /**
     * Resolve one user-facing message for a Host error code.
     *
     * @param code - error code from the Host or from a local pre-check.
     * @param t - translate function of this namespace.
     * @returns localized text.
     */
    function messageFor(code, t) {
      if (code === 'too-large') return t('tooLarge');
      if (code === 'unsupported') return t('unsupported');
      if (code === 'video') return t('video');
      return t('failed');
    }

    /**
     * Reject a video file before uploading it: the wallpaper is CSS-painted and
     * the framework offers no layer behind the app columns for a video element.
     *
     * @param file - picked file.
     * @returns true for anything the Host cannot render as a wallpaper.
     */
    function looksLikeVideo(file) {
      if (typeof file.type === 'string' && file.type.startsWith('video/')) return true;
      return /\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/i.test(file.name ?? '');
    }

    /** The one stylesheet carrying the wallpaper and its veil. */
    function wallpaperCss(state) {
      const url = state?.background?.url;
      if (typeof url !== 'string' || url === '') return '';
      const dim = typeof state.dim === 'number' && Number.isFinite(state.dim) ? Math.min(0.85, Math.max(0, state.dim)) : 0.25;
      const safeUrl = url.replace(/["\\\r\n]/g, (character) => encodeURIComponent(character));
      return [
        'body{',
        'background-color:transparent!important;',
        `background-image:linear-gradient(rgba(0,0,0,${dim.toFixed(3)}),rgba(0,0,0,${dim.toFixed(3)})),url("${safeUrl}")!important;`,
        'background-size:cover!important;',
        'background-position:center center!important;',
        'background-repeat:no-repeat!important;',
        'background-attachment:fixed!important;',
        '}',
      ].join('');
    }

    /** Tokens that let the wallpaper show through the app chrome. */
    const WALLPAPER_TOKENS = {
      '--dsw-alias-bg-base': { light: 'transparent', dark: 'transparent' },
      '--dsw-specific-sidebar-fill': { light: 'rgba(255,255,255,0.55)', dark: 'rgba(18,20,26,0.55)' },
    };

    /**
     * Client plugin body.
     *
     * @param ctx - Client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'dsh-style: zh dictionary');
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'dsh-style: en dictionary');
      const translate = ctx.locale.bind(NS);
      const t = (key) => {
        try {
          const value = translate(key);
          return typeof value === 'string' && value !== '' ? value : key;
        } catch {
          return key;
        }
      };

      /* Page styles for the settings section: static, mounted once. */
      ctx.effect(() => {
        const element = document.createElement('style');
        element.dataset.dshStyle = 'settings';
        element.textContent = settingsCss;
        document.head.appendChild(element);
        return () => element.remove();
      }, 'dsh-style: settings stylesheet');

      /* The wallpaper stylesheet plus the token layer that reveals it. */
      ctx.effect(() => {
        const element = document.createElement('style');
        element.dataset.dshStyle = 'wallpaper';
        document.head.appendChild(element);
        let tokenDispose = null;
        let tokensActive = false;
        let lastCss = null;
        const paint = () => {
          const css = wallpaperCss(snapshot);
          if (css !== lastCss) {
            lastCss = css;
            element.textContent = css;
          }
          /* Dragging the veil rewrites CSS only: the token layer is stable per presence. */
          const wanted = snapshot?.background != null;
          if (wanted === tokensActive) return;
          tokensActive = wanted;
          if (tokenDispose !== null) {
            tokenDispose();
            tokenDispose = null;
          }
          if (wanted) tokenDispose = ctx.theme.overrideTokens('dsh-style-wallpaper', WALLPAPER_TOKENS);
        };
        const off = subscribe(paint);
        paint();
        return () => {
          off();
          if (tokenDispose !== null) tokenDispose();
          element.remove();
        };
      }, 'dsh-style: wallpaper');

      /* ---- brand slots: registered only while a value is configured ---- */
      let markHandle = null;
      let nameHandle = null;

      const syncBrand = () => {
        const wantsLogo = typeof snapshot?.logo?.url === 'string' && snapshot.logo.url !== '';
        const wantsName = typeof snapshot?.name === 'string' && snapshot.name.trim() !== '';
        markHandle = syncRegistration(ctx, markHandle, wantsLogo, 'sidebar.brand.mark', BrandMark);
        nameHandle = syncRegistration(ctx, nameHandle, wantsName, 'sidebar.brand.name', BrandName);
      };

      ctx.effect(() => {
        const off = subscribe(syncBrand);
        syncBrand();
        return () => {
          off();
          if (markHandle !== null) markHandle();
          if (nameHandle !== null) nameHandle();
          markHandle = null;
          nameHandle = null;
        };
      }, 'dsh-style: brand slots');

      /* ---- the settings page ---- */
      safeInject(ctx, 'settings.section', { name: 'settings.section', id: 'dsh-style', order: 25, label: () => t('section.title') }, SettingsPage);
      safeInject(ctx, 'settings.section.icon', { name: 'settings.section.icon', id: 'dsh-style', order: 25 }, SettingsIcon);

      void refresh();

      /* ---- components ---- */

      /**
       * Register or drop one `single`-slot occupant.
       *
       * @param handle - previous injection handle, if any.
       * @param wanted - whether the slot should currently be occupied.
       * @param key - slot key.
       * @param Component - occupant component.
       * @returns the handle to keep, or null after disposing it.
       */
      function syncRegistration(ctxRef, handle, wanted, key, Component) {
        try {
          if (wanted && handle === null) {
            return ctxRef.slots.inject(key, () =>
              ctxRef.slots.register({ name: key, priority: SHADOW_PRIORITY }, Component),
            );
          }
          if (!wanted && handle !== null) {
            handle();
            return null;
          }
        } catch (error) {
          console.error(`[dsh-style] could not ${wanted ? 'claim' : 'release'} '${key}'`, error);
          return null;
        }
        return handle;
      }

      /**
       * Register an always-on occupant, tolerating a cell another live copy of
       * this plugin still holds (a page refresh clears the duplicate).
       *
       * @param ctxRef - client context.
       * @param key - slot key.
       * @param options - registration options.
       * @param Component - occupant component.
       * @returns the injection handle, or null when the cell was taken.
       */
      function safeInject(ctxRef, key, options, Component) {
        try {
          return ctxRef.slots.inject(key, () => ctxRef.slots.register(options, Component));
        } catch (error) {
          console.error(`[dsh-style] could not register '${key}'`, error);
          return null;
        }
      }

      function BrandMark(props) {
        useRevision();
        const url = snapshot?.logo?.url;
        if (typeof url !== 'string' || url === '') return null;
        const edge = typeof props?.size === 'number' && props.size > 0 ? props.size : 24;
        return h('img', {
          src: url,
          alt: '',
          width: edge,
          height: edge,
          draggable: false,
          style: {
            display: 'block',
            width: `${edge}px`,
            height: `${edge}px`,
            objectFit: 'contain',
            borderRadius: `${Math.round(edge * 0.22)}px`,
          },
        });
      }

      function BrandName() {
        useRevision();
        const name = typeof snapshot?.name === 'string' ? snapshot.name.trim() : '';
        if (name === '') return null;
        return h(
          'span',
          {
            title: name,
            style: {
              display: 'block',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.2px',
              lineHeight: 1.2,
              color: 'var(--dsw-alias-label-primary)',
            },
          },
          name,
        );
      }

      /**
       * Subscribe to store revisions.
       *
       * @returns the current revision (unused; the render reads the module store).
       */
      function useRevision() {
        return React.useSyncExternalStore(subscribe, getRevision, getRevision);
      }

      function SettingsIcon(props) {
        const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 16;
        return h(
          'svg',
          { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('rect', { x: 1.3, y: 2.3, width: 13.4, height: 11.4, rx: 2.6, stroke: 'currentColor', strokeWidth: 1.3 }),
          h('circle', { cx: 5.4, cy: 6.1, r: 1.35, fill: 'currentColor' }),
          h('path', {
            d: 'M2.7 12.1 6.3 8.4l2.35 2.4 2.2-2.2 2.45 2.5',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        );
      }

      function SettingsPage() {
        useRevision();
        const data = snapshot;
        const failed = loadFailed;
        const [nameDraft, setNameDraft] = React.useState(null);
        const [dimDraft, setDimDraft] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const dimTimer = React.useRef(null);

        React.useEffect(
          () => () => {
            if (dimTimer.current !== null) clearTimeout(dimTimer.current);
          },
          [],
        );

        const name = nameDraft ?? (typeof data?.name === 'string' ? data.name : '');
        const dim = dimDraft ?? (typeof data?.dim === 'number' ? data.dim : 0.25);

        const run = async (operation) => {
          setBusy(true);
          setNotice(null);
          try {
            await operation();
          } catch {
            setNotice({ kind: 'error', text: t('failed') });
          } finally {
            setBusy(false);
          }
        };

        const saveName = (next) =>
          run(async () => {
            const payload = await call('/name', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name: next }),
            });
            if (payload?.ok === true) {
              setNameDraft(null);
              setNotice({ kind: 'ok', text: t('saved') });
            } else {
              setNotice({ kind: 'error', text: messageFor(payload?.error, t) });
            }
          });

        const putDim = async (value) => {
          const payload = await call('/options', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dim: value }),
          });
          if (payload?.ok !== true) {
            setNotice({ kind: 'error', text: messageFor(payload?.error, t) });
          }
        };

        const changeDim = (value) => {
          setDimDraft(value);
          if (snapshot !== null) {
            /* Paint immediately; the Host write is debounced behind the drag. */
            snapshot = { ...snapshot, dim: value };
            bump();
          }
          if (dimTimer.current !== null) clearTimeout(dimTimer.current);
          dimTimer.current = setTimeout(() => {
            dimTimer.current = null;
            void putDim(value);
          }, 350);
        };

        const upload = async (kind, file) => {
          if (file === undefined || file === null) return;
          if (kind === 'background' && looksLikeVideo(file)) {
            setNotice({ kind: 'error', text: t('video') });
            return;
          }
          if (file.size > LIMITS[kind]) {
            setNotice({ kind: 'error', text: t('tooLarge') });
            return;
          }
          await run(async () => {
            const payload = await call(`/media?kind=${kind}`, {
              method: 'POST',
              headers: { 'content-type': file.type === '' ? 'application/octet-stream' : file.type },
              body: file,
            });
            if (payload?.ok === true) setNotice({ kind: 'ok', text: t('saved') });
            else setNotice({ kind: 'error', text: messageFor(payload?.error, t) });
          });
        };

        const clear = (kind) =>
          run(async () => {
            const payload = await call(`/media?kind=${kind}`, { method: 'DELETE' });
            if (payload?.ok === true) setNotice({ kind: 'ok', text: t('saved') });
            else setNotice({ kind: 'error', text: messageFor(payload?.error, t) });
          });

        if (data === null) {
          return h(
            'div',
            { className: 'dsh-style-page' },
            h('h2', { className: 'dsh-style-title' }, t('section.title')),
            h('p', { className: 'dsh-style-desc' }, failed ? t('loadFailed') : t('loading')),
            h(
              'div',
              { className: 'dsh-style-actions' },
              h(
                'button',
                { type: 'button', className: 'dsh-style-btn', onClick: () => void refresh() },
                t('retry'),
              ),
            ),
          );
        }

        return h(
          'div',
          { className: 'dsh-style-page' },
          h('header', null, h('h2', { className: 'dsh-style-title' }, t('section.title')), h('p', { className: 'dsh-style-desc' }, t('section.desc'))),
          h(
            'section',
            { className: 'dsh-style-card' },
            h(
              'div',
              { className: 'dsh-style-field' },
              h('span', { className: 'dsh-style-label' }, t('name.label')),
              h(
                'div',
                { className: 'dsh-style-actions' },
                h('input', {
                  className: 'dsh-style-input',
                  type: 'text',
                  value: name,
                  maxLength: 40,
                  placeholder: t('name.placeholder'),
                  disabled: busy,
                  onChange: (event) => setNameDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') void saveName(name.trim());
                  },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-style-btn dsh-style-accent',
                    disabled: busy,
                    onClick: () => void saveName(name.trim()),
                  },
                  t('name.save'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-style-btn',
                    disabled: busy || (data.name === '' && name === ''),
                    onClick: () => void saveName(''),
                  },
                  t('name.reset'),
                ),
              ),
              h('span', { className: 'dsh-style-hint' }, t('name.hint')),
            ),
            h(
              'div',
              { className: 'dsh-style-field' },
              h('span', { className: 'dsh-style-label' }, t('logo.label')),
              h(
                'div',
                { className: 'dsh-style-actions' },
                h(
                  'div',
                  { className: 'dsh-style-thumb' },
                  data.logo === null
                    ? h('span', null, t('empty'))
                    : h('img', { src: data.logo.url, alt: '', className: 'dsh-style-thumb-img' }),
                ),
                h(UploadButton, {
                  label: t('logo.upload'),
                  hint: t('logo.hint'),
                  accept: 'image/*',
                  disabled: busy,
                  onPick: (file) => void upload('logo', file),
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-style-btn',
                    disabled: busy || data.logo === null,
                    onClick: () => void clear('logo'),
                  },
                  t('logo.reset'),
                ),
              ),
              h('span', { className: 'dsh-style-hint' }, t('logo.hint')),
            ),
          ),
          h(
            'section',
            { className: 'dsh-style-card' },
            h(
              'div',
              { className: 'dsh-style-field' },
              h('span', { className: 'dsh-style-label' }, t('background.label')),
              h(
                'div',
                { className: 'dsh-style-actions' },
                h(UploadButton, {
                  label: t('background.upload'),
                  hint: t('background.hint'),
                  accept: 'image/*',
                  disabled: busy,
                  onPick: (file) => void upload('background', file),
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-style-btn',
                    disabled: busy || data.background === null,
                    onClick: () => void clear('background'),
                  },
                  t('background.remove'),
                ),
              ),
              h('span', { className: 'dsh-style-hint' }, t('background.hint')),
              data.background === null
                ? null
                : h('img', { src: data.background.url, alt: '', className: 'dsh-style-media' }),
            ),
            h(
              'div',
              { className: 'dsh-style-field' },
              h('span', { className: 'dsh-style-label' }, t('background.dim')),
              h('input', {
                className: 'dsh-style-range',
                type: 'range',
                min: 0,
                max: 0.85,
                step: 0.05,
                value: dim,
                disabled: busy,
                onChange: (event) => changeDim(Number(event.target.value)),
              }),
              h('span', { className: 'dsh-style-hint' }, t('background.dimHint')),
            ),
          ),
          notice === null
            ? null
            : h('p', { className: 'dsh-style-notice', 'data-kind': notice.kind }, notice.text),
          busy ? h('p', { className: 'dsh-style-hint' }, t('busy')) : null,
        );
      }

      function UploadButton(props) {
        const input = React.useRef(null);
        return h(
          React.Fragment,
          null,
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-style-btn',
              disabled: props.disabled === true,
              title: props.hint,
              onClick: () => {
                if (input.current !== null) input.current.click();
              },
            },
            props.label,
          ),
          h('input', {
            ref: input,
            className: 'dsh-style-file',
            type: 'file',
            accept: props.accept,
            disabled: props.disabled === true,
            onChange: (event) => {
              const files = event.target.files;
              const file = files === null || files === undefined ? undefined : files[0];
              event.target.value = '';
              props.onPick(file);
            },
          }),
        );
      }
    }

    /** Stylesheet of the settings page: theme tokens only. */
    const settingsCss = [
      '.dsh-style-page{display:flex;flex-direction:column;gap:16px;max-width:760px;padding:4px 4px 40px}',
      '.dsh-style-title{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);margin:0 0 4px}',
      '.dsh-style-desc{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0}',
      '.dsh-style-card{display:flex;flex-direction:column;gap:18px;padding:16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.dsh-style-field{display:flex;flex-direction:column;gap:8px}',
      '.dsh-style-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dsh-style-hint{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}',
      '.dsh-style-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-style-input{height:32px;min-width:220px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}',
      '.dsh-style-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-style-input::placeholder{color:var(--dsw-alias-label-secondary)}',
      '.dsh-style-btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}',
      '.dsh-style-btn:hover:not([disabled]){background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-style-btn[disabled]{opacity:.45;cursor:default}',
      '.dsh-style-accent{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-style-thumb{display:grid;place-items:center;width:56px;height:56px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);overflow:hidden;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-style-thumb-img{max-width:44px;max-height:44px;object-fit:contain;display:block}',
      '.dsh-style-media{display:block;width:100%;max-width:360px;aspect-ratio:16/9;object-fit:cover;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-style-range{width:240px;max-width:100%;accent-color:var(--dsw-alias-brand-primary)}',
      '.dsh-style-file{display:none}',
      '.dsh-style-notice{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}',
      '.dsh-style-notice[data-kind=ok]{color:var(--dsw-alias-state-success-primary)}',
    ].join('');

    return {
      inject: ['slots', 'theme', 'locale'],
      apply,
    };
  },
});
