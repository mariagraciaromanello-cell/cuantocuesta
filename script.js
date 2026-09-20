/* =========================================================
   ¿CUÁNTO ME CUESTA? — CHISPA
   Lógica de la aplicación: navegación por pasos, cálculo de
   costos con conversión de unidades, margen de ganancia,
   guardado local y validaciones.
   ========================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     -1. Red de seguridad para la pantalla de carga.
     Esto va ANTES de todo lo demás y fuera de cualquier bloque
     que pueda fallar, para garantizar que la pantalla de carga
     nunca quede trabada, pase lo que pase con el resto del código.
     --------------------------------------------------------- */

  function ocultarPantallaCarga() {
    var pantalla = document.getElementById('pantallaCarga');
    if (pantalla) pantalla.hidden = true;
  }

  function mostrarAvisoInicioFallido() {
    try {
      var main = document.getElementById('main');
      if (main && !document.getElementById('avisoInitError')) {
        var aviso = document.createElement('div');
        aviso.id = 'avisoInitError';
        aviso.className = 'aviso-init-error';
        aviso.textContent = 'Hubo un problema al iniciar la aplicación. Recargá la página; tus cálculos guardados no se pierden.';
        main.insertBefore(aviso, main.firstChild);
      }
    } catch (e2) {
      /* si ni esto funciona, no hay nada más que hacer */
    }
  }

  // Si algo explota en cualquier parte del script, esto asegura que
  // la pantalla de carga desaparezca igual (nunca debe depender de
  // que TODO el código se ejecute sin errores).
  window.addEventListener('error', ocultarPantallaCarga);

  // Seguro absoluto: pase lo que pase, a los 3 segundos la pantalla
  // de carga se oculta sí o sí.
  setTimeout(ocultarPantallaCarga, 3000);

  try {

  /* ---------------------------------------------------------
     0. Constantes y utilidades
     --------------------------------------------------------- */

  var STORAGE_KEY = 'chispa_cuanto_me_cuesta_v1';
  var MAX_HISTORIAL = 12;

  var fmtMoneda;
  try {
    fmtMoneda = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2
    });
  } catch (errorIntl) {
    // Si el navegador no soporta Intl.NumberFormat con ARS,
    // usamos un formateador propio bien simple como respaldo.
    fmtMoneda = null;
  }

  function formatearMoneda(numero) {
    if (!isFinite(numero)) return '$0';
    // Evitar mostrar -0
    var valor = Math.round((numero + Number.EPSILON) * 100) / 100;
    if (Object.is(valor, -0)) valor = 0;

    if (fmtMoneda) {
      try {
        return fmtMoneda.format(valor);
      } catch (errorFormato) {
        // seguimos al respaldo de abajo
      }
    }

    // Respaldo manual si Intl.NumberFormat no está disponible o falla.
    var partes = Math.abs(valor).toFixed(2).split('.');
    var entero = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (valor < 0 ? '-$' : '$') + entero + ',' + partes[1];
  }

  function formatearPorcentaje(numero) {
    if (!isFinite(numero)) return '0%';
    var valor = Math.round(numero * 10) / 10;
    return valor.toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';
  }

  function generarId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function numeroValido(valor) {
    return typeof valor === 'number' && isFinite(valor);
  }

  function toNumero(valorString) {
    if (valorString === '' || valorString === null || valorString === undefined) return NaN;
    var n = Number(String(valorString).replace(',', '.'));
    return n;
  }

  /* ---------------------------------------------------------
     1. Conversión de unidades
     --------------------------------------------------------- */

  // Grupos de unidades compatibles. Cada unidad tiene un factor
  // de conversión a una unidad base del grupo.
  var GRUPOS_UNIDAD = {
    masa: { gramos: 1, kilogramos: 1000 },
    volumen: { mililitros: 1, litros: 1000 },
    unidades: { unidades: 1 },
    metros: { metros: 1 },
    horas: { horas: 1 },
    otra: { otra: 1 }
  };

  function grupoDeUnidad(unidad) {
    for (var grupo in GRUPOS_UNIDAD) {
      if (Object.prototype.hasOwnProperty.call(GRUPOS_UNIDAD[grupo], unidad)) {
        return grupo;
      }
    }
    return null;
  }

  function unidadesCompatibles(unidadA, unidadB) {
    var grupoA = grupoDeUnidad(unidadA);
    var grupoB = grupoDeUnidad(unidadB);
    return grupoA !== null && grupoA === grupoB;
  }

  // Convierte una cantidad de unidadOrigen a unidadDestino.
  // Devuelve null si las unidades no son compatibles.
  function convertir(cantidad, unidadOrigen, unidadDestino) {
    if (!unidadesCompatibles(unidadOrigen, unidadDestino)) return null;
    var grupo = grupoDeUnidad(unidadOrigen);
    var factorOrigen = GRUPOS_UNIDAD[grupo][unidadOrigen];
    var factorDestino = GRUPOS_UNIDAD[grupo][unidadDestino];
    var enBase = cantidad * factorOrigen;
    return enBase / factorDestino;
  }

  var ETIQUETAS_UNIDAD = {
    gramos: 'g',
    kilogramos: 'kg',
    mililitros: 'ml',
    litros: 'l',
    unidades: 'u',
    metros: 'm',
    horas: 'h',
    otra: ''
  };

  /* ---------------------------------------------------------
     2. Estado de la aplicación
     --------------------------------------------------------- */

  var state = {
    producto: '',
    categoria: '',
    costos: [],   // { id, nombre, precio, cantidadComprada, unidadComprada, cantidadUsada, unidadUsada, costoUtilizado }
    otros: [],    // { id, nombre, importe }
    unidadesObtenidas: null
  };

  var editandoCostoId = null;
  var editandoOtroId = null;
  var margenSeleccionado = null; // 20 | 30 | 50 | 70 | 100 | 'personalizado'

  /* ---------------------------------------------------------
     3. Navegación entre pantallas
     --------------------------------------------------------- */

  var ORDEN_PASOS = ['inicio', 'producto', 'costos', 'cantidad', 'resultado'];

  function irAPantalla(nombre) {
    var pantallas = document.querySelectorAll('.screen');
    for (var i = 0; i < pantallas.length; i++) {
      pantallas[i].classList.remove('active');
    }
    var destino = document.getElementById('screen-' + nombre);
    if (destino) destino.classList.add('active');

    actualizarIndicadorPasos(nombre);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    if (nombre === 'inicio') renderHistorial();
  }

  function actualizarIndicadorPasos(nombreActual) {
    var indice = ORDEN_PASOS.indexOf(nombreActual);
    var dots = document.querySelectorAll('#stepIndicator .step-dot');
    dots.forEach(function (dot) {
      var pasoDot = ORDEN_PASOS.indexOf(dot.getAttribute('data-step'));
      dot.classList.remove('active', 'done');
      if (pasoDot < indice) dot.classList.add('done');
      if (pasoDot === indice) dot.classList.add('active');
    });
  }

  /* ---------------------------------------------------------
     4. Toast de confirmación
     --------------------------------------------------------- */

  var toastTimeout = null;
  function mostrarToast(mensaje) {
    var toast = document.getElementById('toast');
    toast.textContent = mensaje;
    toast.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
      toast.hidden = true;
    }, 2600);
  }

  /* ---------------------------------------------------------
     5. Paso 1: producto y categoría
     --------------------------------------------------------- */

  var categoriasEl = document.getElementById('categorias');
  categoriasEl.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var yaSeleccionado = chip.classList.contains('selected');
    categoriasEl.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('selected'); });
    if (!yaSeleccionado) {
      chip.classList.add('selected');
      state.categoria = chip.getAttribute('data-cat');
      var inputProducto = document.getElementById('inputProducto');
      if (!inputProducto.value.trim()) {
        // sugerir el nombre de la categoría como punto de partida, sin forzarlo
        inputProducto.focus();
      }
    } else {
      state.categoria = '';
    }
  });

  document.getElementById('btnContinuarProducto').addEventListener('click', function () {
    var input = document.getElementById('inputProducto');
    var errorEl = document.getElementById('errorProducto');
    var valor = input.value.trim();

    if (!valor) {
      errorEl.textContent = 'Contanos qué vas a calcular.';
      input.focus();
      return;
    }

    errorEl.textContent = '';
    state.producto = valor;
    document.getElementById('nombreProductoCostos').textContent = valor;
    irAPantalla('costos');
  });

  /* ---------------------------------------------------------
     6. Paso 2: lista de costos
     --------------------------------------------------------- */

  function calcularCostoUtilizado(costo) {
    var convertido = convertir(costo.cantidadUsada, costo.unidadUsada, costo.unidadComprada);
    if (convertido === null) return null;
    if (!costo.cantidadComprada || costo.cantidadComprada <= 0) return null;
    var precioUnitario = costo.precio / costo.cantidadComprada;
    return precioUnitario * convertido;
  }

  function renderListaCostos() {
    var ul = document.getElementById('listaCostos');
    ul.innerHTML = '';

    if (state.costos.length === 0) {
      var vacio = document.createElement('li');
      vacio.className = 'vacio-lista';
      vacio.textContent = 'Todavía no agregaste ningún costo.';
      ul.appendChild(vacio);
      return;
    }

    state.costos.forEach(function (costo) {
      var li = document.createElement('li');
      li.className = 'costo-item';

      var info = document.createElement('div');
      info.className = 'costo-info';

      var nombre = document.createElement('span');
      nombre.className = 'costo-nombre';
      nombre.textContent = costo.nombre;

      var detalle = document.createElement('span');
      detalle.className = 'costo-detalle';
      var uComprada = ETIQUETAS_UNIDAD[costo.unidadComprada] || costo.unidadComprada;
      var uUsada = ETIQUETAS_UNIDAD[costo.unidadUsada] || costo.unidadUsada;
      detalle.textContent = 'Compraste ' + formatearNumero(costo.cantidadComprada) + ' ' + uComprada +
        ' por ' + formatearMoneda(costo.precio) + '. Usaste ' + formatearNumero(costo.cantidadUsada) + ' ' + uUsada + '.';

      info.appendChild(nombre);
      info.appendChild(detalle);

      var valor = document.createElement('span');
      valor.className = 'costo-valor';
      valor.textContent = costo.costoUtilizado !== null ? formatearMoneda(costo.costoUtilizado) : '—';

      var acciones = document.createElement('div');
      acciones.className = 'costo-acciones';

      var btnEditar = document.createElement('button');
      btnEditar.type = 'button';
      btnEditar.className = 'icon-btn';
      btnEditar.setAttribute('aria-label', 'Editar ' + costo.nombre);
      btnEditar.textContent = '✏️';
      btnEditar.addEventListener('click', function () { abrirModalCosto(costo.id); });

      var btnEliminar = document.createElement('button');
      btnEliminar.type = 'button';
      btnEliminar.className = 'icon-btn danger';
      btnEliminar.setAttribute('aria-label', 'Eliminar ' + costo.nombre);
      btnEliminar.textContent = '🗑️';
      btnEliminar.addEventListener('click', function () {
        state.costos = state.costos.filter(function (c) { return c.id !== costo.id; });
        renderListaCostos();
        mostrarToast('Costo eliminado.');
      });

      acciones.appendChild(btnEditar);
      acciones.appendChild(btnEliminar);

      li.appendChild(info);
      li.appendChild(valor);
      li.appendChild(acciones);
      ul.appendChild(li);
    });
  }

  function formatearNumero(n) {
    if (!numeroValido(n)) return '0';
    return n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
  }

  /* ----- Modal de costo ----- */

  var modalCosto = document.getElementById('modalCosto');
  var campoModalNombre = document.getElementById('modalNombre');
  var campoModalPrecio = document.getElementById('modalPrecio');
  var campoModalCantidadComprada = document.getElementById('modalCantidadComprada');
  var campoModalUnidadComprada = document.getElementById('modalUnidadComprada');
  var campoModalCantidadUsada = document.getElementById('modalCantidadUsada');
  var campoModalUnidadUsada = document.getElementById('modalUnidadUsada');
  var errorModalCosto = document.getElementById('errorModalCosto');
  var previewCosto = document.getElementById('previewCosto');

  function abrirModalCosto(idExistente) {
    editandoCostoId = idExistente || null;
    errorModalCosto.textContent = '';
    previewCosto.hidden = true;

    if (idExistente) {
      var costo = state.costos.find(function (c) { return c.id === idExistente; });
      document.getElementById('tituloModalCosto').textContent = 'Editar costo';
      campoModalNombre.value = costo.nombre;
      campoModalPrecio.value = costo.precio;
      campoModalCantidadComprada.value = costo.cantidadComprada;
      campoModalUnidadComprada.value = costo.unidadComprada;
      campoModalCantidadUsada.value = costo.cantidadUsada;
      campoModalUnidadUsada.value = costo.unidadUsada;
    } else {
      document.getElementById('tituloModalCosto').textContent = 'Agregar costo';
      campoModalNombre.value = '';
      campoModalPrecio.value = '';
      campoModalCantidadComprada.value = '';
      campoModalUnidadComprada.value = 'gramos';
      campoModalCantidadUsada.value = '';
      campoModalUnidadUsada.value = 'gramos';
    }

    modalCosto.hidden = false;
    setTimeout(function () { campoModalNombre.focus(); }, 50);
  }

  function cerrarModalCosto() {
    modalCosto.hidden = true;
    editandoCostoId = null;
  }

  function actualizarPreviewCosto() {
    var precio = toNumero(campoModalPrecio.value);
    var cantidadComprada = toNumero(campoModalCantidadComprada.value);
    var unidadComprada = campoModalUnidadComprada.value;
    var cantidadUsada = toNumero(campoModalCantidadUsada.value);
    var unidadUsada = campoModalUnidadUsada.value;

    if (!numeroValido(precio) || !numeroValido(cantidadComprada) || !numeroValido(cantidadUsada) ||
        precio < 0 || cantidadComprada <= 0 || cantidadUsada < 0) {
      previewCosto.hidden = true;
      return;
    }

    if (!unidadesCompatibles(unidadComprada, unidadUsada)) {
      previewCosto.hidden = true;
      return;
    }

    var convertido = convertir(cantidadUsada, unidadUsada, unidadComprada);
    var resultado = (precio / cantidadComprada) * convertido;
    previewCosto.hidden = false;
    previewCosto.textContent = 'Costo utilizado: ' + formatearMoneda(resultado);
  }

  [campoModalPrecio, campoModalCantidadComprada, campoModalUnidadComprada, campoModalCantidadUsada, campoModalUnidadUsada]
    .forEach(function (el) { el.addEventListener('input', actualizarPreviewCosto); });

  document.getElementById('btnAgregarCosto').addEventListener('click', function () { abrirModalCosto(null); });
  document.getElementById('btnCancelarModalCosto').addEventListener('click', cerrarModalCosto);

  document.getElementById('btnGuardarModalCosto').addEventListener('click', function () {
    var nombre = campoModalNombre.value.trim();
    var precio = toNumero(campoModalPrecio.value);
    var cantidadComprada = toNumero(campoModalCantidadComprada.value);
    var unidadComprada = campoModalUnidadComprada.value;
    var cantidadUsada = toNumero(campoModalCantidadUsada.value);
    var unidadUsada = campoModalUnidadUsada.value;

    if (!nombre) {
      errorModalCosto.textContent = 'Poné un nombre para este costo.';
      return;
    }
    if (!numeroValido(precio) || precio < 0) {
      errorModalCosto.textContent = 'Revisá el precio de compra.';
      return;
    }
    if (!numeroValido(cantidadComprada) || cantidadComprada <= 0) {
      errorModalCosto.textContent = 'Revisá la cantidad comprada.';
      return;
    }
    if (!numeroValido(cantidadUsada) || cantidadUsada < 0) {
      errorModalCosto.textContent = 'Revisá la cantidad utilizada.';
      return;
    }
    if (cantidadComprada > 1e12 || cantidadUsada > 1e12 || precio > 1e12) {
      errorModalCosto.textContent = 'Ese número es demasiado grande. Probá con uno más chico.';
      return;
    }
    if (!unidadesCompatibles(unidadComprada, unidadUsada)) {
      errorModalCosto.textContent = 'Esas unidades no se pueden combinar. Elegí unidades del mismo tipo (por ejemplo, kg y g).';
      return;
    }

    var convertido = convertir(cantidadUsada, unidadUsada, unidadComprada);
    if (convertido > cantidadComprada * 1.0001) {
      errorModalCosto.textContent = 'Usaste más cantidad de la que compraste. Revisá los números.';
      return;
    }

    var costoUtilizado = (precio / cantidadComprada) * convertido;

    if (editandoCostoId) {
      var existente = state.costos.find(function (c) { return c.id === editandoCostoId; });
      existente.nombre = nombre;
      existente.precio = precio;
      existente.cantidadComprada = cantidadComprada;
      existente.unidadComprada = unidadComprada;
      existente.cantidadUsada = cantidadUsada;
      existente.unidadUsada = unidadUsada;
      existente.costoUtilizado = costoUtilizado;
      mostrarToast('Costo actualizado.');
    } else {
      state.costos.push({
        id: generarId(),
        nombre: nombre,
        precio: precio,
        cantidadComprada: cantidadComprada,
        unidadComprada: unidadComprada,
        cantidadUsada: cantidadUsada,
        unidadUsada: unidadUsada,
        costoUtilizado: costoUtilizado
      });
      mostrarToast('Costo agregado.');
    }

    errorModalCosto.textContent = '';
    cerrarModalCosto();
    renderListaCostos();
  });

  /* ----- Otros gastos ----- */

  function renderListaOtros() {
    var ul = document.getElementById('listaOtros');
    ul.innerHTML = '';

    if (state.otros.length === 0) {
      var vacio = document.createElement('li');
      vacio.className = 'vacio-lista';
      vacio.textContent = 'No agregaste otros gastos todavía.';
      ul.appendChild(vacio);
      return;
    }

    state.otros.forEach(function (otro) {
      var li = document.createElement('li');
      li.className = 'costo-item';

      var info = document.createElement('div');
      info.className = 'costo-info';
      var nombre = document.createElement('span');
      nombre.className = 'costo-nombre';
      nombre.textContent = otro.nombre;
      info.appendChild(nombre);

      var valor = document.createElement('span');
      valor.className = 'costo-valor';
      valor.textContent = formatearMoneda(otro.importe);

      var acciones = document.createElement('div');
      acciones.className = 'costo-acciones';

      var btnEditar = document.createElement('button');
      btnEditar.type = 'button';
      btnEditar.className = 'icon-btn';
      btnEditar.setAttribute('aria-label', 'Editar ' + otro.nombre);
      btnEditar.textContent = '✏️';
      btnEditar.addEventListener('click', function () { abrirModalOtro(otro.id); });

      var btnEliminar = document.createElement('button');
      btnEliminar.type = 'button';
      btnEliminar.className = 'icon-btn danger';
      btnEliminar.setAttribute('aria-label', 'Eliminar ' + otro.nombre);
      btnEliminar.textContent = '🗑️';
      btnEliminar.addEventListener('click', function () {
        state.otros = state.otros.filter(function (o) { return o.id !== otro.id; });
        renderListaOtros();
        mostrarToast('Gasto eliminado.');
      });

      acciones.appendChild(btnEditar);
      acciones.appendChild(btnEliminar);

      li.appendChild(info);
      li.appendChild(valor);
      li.appendChild(acciones);
      ul.appendChild(li);
    });
  }

  var modalOtro = document.getElementById('modalOtro');
  var campoModalOtroNombre = document.getElementById('modalOtroNombre');
  var campoModalOtroImporte = document.getElementById('modalOtroImporte');
  var errorModalOtro = document.getElementById('errorModalOtro');

  function abrirModalOtro(idExistente) {
    editandoOtroId = idExistente || null;
    errorModalOtro.textContent = '';
    if (idExistente) {
      var otro = state.otros.find(function (o) { return o.id === idExistente; });
      document.getElementById('tituloModalOtro').textContent = 'Editar gasto';
      campoModalOtroNombre.value = otro.nombre;
      campoModalOtroImporte.value = otro.importe;
    } else {
      document.getElementById('tituloModalOtro').textContent = 'Agregar otro gasto';
      campoModalOtroNombre.value = '';
      campoModalOtroImporte.value = '';
    }
    modalOtro.hidden = false;
    setTimeout(function () { campoModalOtroNombre.focus(); }, 50);
  }

  function cerrarModalOtro() {
    modalOtro.hidden = true;
    editandoOtroId = null;
  }

  document.getElementById('btnAgregarOtro').addEventListener('click', function () { abrirModalOtro(null); });
  document.getElementById('btnCancelarModalOtro').addEventListener('click', cerrarModalOtro);

  document.getElementById('btnGuardarModalOtro').addEventListener('click', function () {
    var nombre = campoModalOtroNombre.value.trim();
    var importe = toNumero(campoModalOtroImporte.value);

    if (!nombre) {
      errorModalOtro.textContent = 'Poné un nombre para este gasto.';
      return;
    }
    if (!numeroValido(importe) || importe < 0) {
      errorModalOtro.textContent = 'Revisá el importe.';
      return;
    }
    if (importe > 1e12) {
      errorModalOtro.textContent = 'Ese número es demasiado grande. Probá con uno más chico.';
      return;
    }

    if (editandoOtroId) {
      var existente = state.otros.find(function (o) { return o.id === editandoOtroId; });
      existente.nombre = nombre;
      existente.importe = importe;
      mostrarToast('Gasto actualizado.');
    } else {
      state.otros.push({ id: generarId(), nombre: nombre, importe: importe });
      mostrarToast('Gasto agregado.');
    }

    cerrarModalOtro();
    renderListaOtros();
  });

  document.getElementById('btnContinuarCostos').addEventListener('click', function () {
    if (state.costos.length === 0 && state.otros.length === 0) {
      mostrarToast('Agregá al menos un costo para continuar.');
      return;
    }
    irAPantalla('cantidad');
  });

  /* ---------------------------------------------------------
     7. Paso 3: cantidad de unidades
     --------------------------------------------------------- */

  document.getElementById('btnVerResultado').addEventListener('click', function () {
    var input = document.getElementById('inputUnidades');
    var errorEl = document.getElementById('errorUnidades');
    var valor = input.value.trim();

    if (valor === '') {
      state.unidadesObtenidas = null;
      errorEl.textContent = '';
    } else {
      var n = toNumero(valor);
      if (!numeroValido(n) || n <= 0) {
        errorEl.textContent = 'Revisá la cantidad de unidades.';
        return;
      }
      if (n > 1e9) {
        errorEl.textContent = 'Ese número es demasiado grande. Probá con uno más chico.';
        return;
      }
      state.unidadesObtenidas = n;
      errorEl.textContent = '';
    }

    calcularYMostrarResultado();
    document.getElementById('errorGuardarCalculo').textContent = '';
    irAPantalla('resultado');
  });

  /* ---------------------------------------------------------
     8. Resultado y margen de ganancia
     --------------------------------------------------------- */

  function totalMateriales() {
    return state.costos.reduce(function (acc, c) {
      return acc + (numeroValido(c.costoUtilizado) ? c.costoUtilizado : 0);
    }, 0);
  }

  function totalOtros() {
    return state.otros.reduce(function (acc, o) { return acc + o.importe; }, 0);
  }

  function costoTotal() {
    return totalMateriales() + totalOtros();
  }

  function calcularYMostrarResultado() {
    var materiales = totalMateriales();
    var otros = totalOtros();
    var total = materiales + otros;

    document.getElementById('costoTotalValor').textContent = formatearMoneda(total);
    document.getElementById('resumenMateriales').textContent = formatearMoneda(materiales);
    document.getElementById('resumenOtros').textContent = formatearMoneda(otros);
    document.getElementById('resumenTotal').textContent = formatearMoneda(total);

    var bloqueUnidad = document.getElementById('costoUnidadBloque');
    var filaUnidades = document.getElementById('resumenUnidadesFila');

    if (state.unidadesObtenidas && state.unidadesObtenidas > 0) {
      var porUnidad = total / state.unidadesObtenidas;
      bloqueUnidad.hidden = false;
      document.getElementById('costoUnidadValor').textContent = formatearMoneda(porUnidad);
      filaUnidades.hidden = false;
      document.getElementById('resumenUnidades').textContent = formatearNumero(state.unidadesObtenidas);
    } else {
      bloqueUnidad.hidden = true;
      filaUnidades.hidden = true;
    }

    // Resetear bloque de margen y de "probar otro precio" para el nuevo cálculo
    margenSeleccionado = null;
    document.getElementById('cobrarPanel').hidden = true;
    document.getElementById('cobrarPreguntaBotones').hidden = false;
    document.querySelectorAll('.chip-margen').forEach(function (c) { c.classList.remove('selected'); });
    document.getElementById('margenPersonalizadoCampo').hidden = true;
    document.getElementById('margenResultado').hidden = true;
    document.getElementById('inputMargenPersonalizado').value = '';
    document.getElementById('inputPrecioProbar').value = '';
    document.getElementById('probarResultado').hidden = true;
    document.getElementById('errorGuardarCalculo').textContent = '';
  }

  // Costo de referencia para "cuánto cobrar": por unidad si existe, si no el total.
  function costoDeReferenciaParaVenta() {
    var total = costoTotal();
    if (state.unidadesObtenidas && state.unidadesObtenidas > 0) {
      return total / state.unidadesObtenidas;
    }
    return total;
  }

  document.getElementById('btnGuardarCalculo').addEventListener('click', guardarCalculoActual);

  document.getElementById('btnCobrarSi').addEventListener('click', function () {
    document.getElementById('cobrarPreguntaBotones').hidden = true;
    document.getElementById('cobrarPanel').hidden = false;
  });

  document.getElementById('btnCobrarNo').addEventListener('click', function () {
    document.getElementById('cobrarPreguntaBotones').hidden = true;
    document.getElementById('cobrarPanel').hidden = true;
  });

  document.getElementById('margenes').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip-margen');
    if (!chip) return;
    document.querySelectorAll('.chip-margen').forEach(function (c) { c.classList.remove('selected'); });
    chip.classList.add('selected');
    var valor = chip.getAttribute('data-margen');
    var campoPersonalizado = document.getElementById('margenPersonalizadoCampo');

    if (valor === 'personalizado') {
      margenSeleccionado = 'personalizado';
      campoPersonalizado.hidden = false;
      document.getElementById('inputMargenPersonalizado').focus();
      calcularMargen();
    } else {
      margenSeleccionado = Number(valor);
      campoPersonalizado.hidden = true;
      calcularMargen();
    }
  });

  document.getElementById('inputMargenPersonalizado').addEventListener('input', calcularMargen);

  function calcularMargen() {
    var costo = costoDeReferenciaParaVenta();
    var porcentaje;

    if (margenSeleccionado === 'personalizado') {
      var valor = toNumero(document.getElementById('inputMargenPersonalizado').value);
      if (!numeroValido(valor) || valor < 0) {
        document.getElementById('margenResultado').hidden = true;
        return;
      }
      porcentaje = valor;
    } else if (typeof margenSeleccionado === 'number') {
      porcentaje = margenSeleccionado;
    } else {
      return;
    }

    var ganancia = costo * (porcentaje / 100);
    var precioSugerido = costo + ganancia;

    document.getElementById('margenCosto').textContent = formatearMoneda(costo);
    document.getElementById('margenGanancia').textContent = formatearMoneda(ganancia);
    document.getElementById('margenPrecioSugerido').textContent = formatearMoneda(precioSugerido);
    document.getElementById('margenResultado').hidden = false;
  }

  /* ----- Probar otro precio ----- */

  document.getElementById('inputPrecioProbar').addEventListener('input', function () {
    var contenedor = document.getElementById('probarResultado');
    var valor = toNumero(this.value);

    if (this.value.trim() === '' || !numeroValido(valor) || valor < 0) {
      contenedor.hidden = true;
      return;
    }

    var costo = costoDeReferenciaParaVenta();
    var ganancia = valor - costo;
    var recargo = costo > 0 ? (ganancia / costo) * 100 : 0;

    document.getElementById('probarCosto').textContent = formatearMoneda(costo);
    var elGanancia = document.getElementById('probarGanancia');
    elGanancia.textContent = formatearMoneda(ganancia);
    elGanancia.classList.toggle('negativo', ganancia < 0);
    document.getElementById('probarRecargo').textContent = formatearPorcentaje(recargo);

    contenedor.hidden = false;
  });

  /* ---------------------------------------------------------
     9. Copiar y compartir
     --------------------------------------------------------- */

  function textoResultado() {
    var lineas = [];
    lineas.push('🧮 ¿Cuánto me cuesta? — ' + (state.producto || 'Mi cálculo'));
    lineas.push('Materiales: ' + formatearMoneda(totalMateriales()));
    lineas.push('Otros gastos: ' + formatearMoneda(totalOtros()));
    lineas.push('Costo total: ' + formatearMoneda(costoTotal()));
    if (state.unidadesObtenidas) {
      lineas.push('Unidades: ' + formatearNumero(state.unidadesObtenidas));
      lineas.push('Costo por unidad: ' + formatearMoneda(costoTotal() / state.unidadesObtenidas));
    }
    lineas.push('');
    lineas.push('Calculado con ¿Cuánto me cuesta? de CHISPA ✨');
    return lineas.join('\n');
  }

  document.getElementById('btnCopiar').addEventListener('click', function () {
    var texto = textoResultado();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () {
        mostrarToast('Resultado copiado.');
      }).catch(function () {
        copiarConFallback(texto);
      });
    } else {
      copiarConFallback(texto);
    }
  });

  function copiarConFallback(texto) {
    var textarea = document.createElement('textarea');
    textarea.value = texto;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      mostrarToast('Resultado copiado.');
    } catch (err) {
      mostrarToast('No se pudo copiar. Copialo manualmente.');
    }
    document.body.removeChild(textarea);
  }

  document.getElementById('btnCompartir').addEventListener('click', function () {
    var texto = textoResultado();
    if (navigator.share) {
      navigator.share({ title: '¿Cuánto me cuesta?', text: texto }).catch(function () {
        // el usuario canceló, no hacemos nada
      });
    } else {
      copiarConFallback(texto);
      mostrarToast('Resultado copiado para compartir.');
    }
  });

  document.getElementById('btnCalcularOtra').addEventListener('click', function () {
    reiniciarCalculoActual();
    irAPantalla('inicio');
  });

  function reiniciarCalculoActual() {
    state.producto = '';
    state.categoria = '';
    state.costos = [];
    state.otros = [];
    state.unidadesObtenidas = null;
    margenSeleccionado = null;

    document.getElementById('inputProducto').value = '';
    document.getElementById('inputUnidades').value = '';
    document.querySelectorAll('#categorias .chip').forEach(function (c) { c.classList.remove('selected'); });
    document.getElementById('errorProducto').textContent = '';
    document.getElementById('errorUnidades').textContent = '';
    renderListaCostos();
    renderListaOtros();
  }

  /* ---------------------------------------------------------
     10. Guardado local (historial de cálculos)
     --------------------------------------------------------- */

  function leerHistorial() {
    try {
      var crudo = localStorage.getItem(STORAGE_KEY);
      if (!crudo) return [];
      var datos = JSON.parse(crudo);
      return Array.isArray(datos) ? datos : [];
    } catch (err) {
      return [];
    }
  }

  function guardarHistorial(lista) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
      return true;
    } catch (err) {
      return false;
    }
  }

  function guardarCalculoEnHistorial() {
    var historial = leerHistorial();

    var registro = {
      id: generarId(),
      fecha: new Date().toISOString(),
      producto: state.producto,
      categoria: state.categoria,
      costos: state.costos,
      otros: state.otros,
      unidadesObtenidas: state.unidadesObtenidas,
      total: costoTotal()
    };

    historial.unshift(registro);
    if (historial.length > MAX_HISTORIAL) historial = historial.slice(0, MAX_HISTORIAL);

    return guardarHistorial(historial);
  }

  function guardarCalculoActual() {
    var errorEl = document.getElementById('errorGuardarCalculo');
    errorEl.textContent = '';

    // 1. Validar los datos antes de guardar.
    if (state.costos.length === 0 && state.otros.length === 0) {
      errorEl.textContent = 'No hay nada para guardar todavía. Agregá al menos un costo.';
      return;
    }

    // 2, 3. Crear el objeto del cálculo y guardarlo mediante localStorage.
    var guardadoOk;
    try {
      guardadoOk = guardarCalculoEnHistorial();
    } catch (errorGuardado) {
      guardadoOk = false;
      if (window.console && console.error) console.error('Error al guardar el cálculo:', errorGuardado);
    }

    if (!guardadoOk) {
      errorEl.textContent = 'No se pudo guardar. Es posible que tu navegador tenga el almacenamiento lleno o bloqueado.';
      return;
    }

    // 4. Actualizar la lista de cálculos guardados.
    renderHistorial();

    // 5. Mostrar una confirmación visible.
    mostrarToast('✓ Cálculo guardado');
  }

  function renderHistorial() {
    var seccion = document.getElementById('historialSection');
    var lista = document.getElementById('historialLista');
    var historial = leerHistorial();

    if (historial.length === 0) {
      seccion.hidden = true;
      return;
    }

    seccion.hidden = false;
    lista.innerHTML = '';

    historial.forEach(function (registro) {
      var li = document.createElement('li');
      li.className = 'historial-item';

      var info = document.createElement('div');
      info.className = 'historial-info';

      var nombre = document.createElement('span');
      nombre.className = 'historial-nombre';
      nombre.textContent = registro.producto || 'Sin nombre';

      var detalle = document.createElement('span');
      detalle.className = 'historial-detalle';
      var fecha = new Date(registro.fecha);
      var fechaTexto = isNaN(fecha.getTime()) ? '' : fecha.toLocaleDateString('es-AR');
      detalle.textContent = formatearMoneda(registro.total) + ' · ' + fechaTexto;

      info.appendChild(nombre);
      info.appendChild(detalle);

      var acciones = document.createElement('div');
      acciones.className = 'historial-acciones';

      var btnAbrir = document.createElement('button');
      btnAbrir.type = 'button';
      btnAbrir.className = 'btn btn-secondary btn-small';
      btnAbrir.textContent = 'Abrir';
      btnAbrir.addEventListener('click', function () { abrirCalculoGuardado(registro); });

      var btnEliminar = document.createElement('button');
      btnEliminar.type = 'button';
      btnEliminar.className = 'icon-btn danger';
      btnEliminar.setAttribute('aria-label', 'Eliminar cálculo ' + (registro.producto || ''));
      btnEliminar.textContent = '🗑️';
      btnEliminar.addEventListener('click', function () {
        var actual = leerHistorial().filter(function (r) { return r.id !== registro.id; });
        guardarHistorial(actual);
        renderHistorial();
        mostrarToast('Cálculo eliminado.');
      });

      acciones.appendChild(btnAbrir);
      acciones.appendChild(btnEliminar);

      li.appendChild(info);
      li.appendChild(acciones);
      lista.appendChild(li);
    });
  }

  function abrirCalculoGuardado(registro) {
    state.producto = registro.producto || '';
    state.categoria = registro.categoria || '';
    state.costos = Array.isArray(registro.costos) ? registro.costos : [];
    state.otros = Array.isArray(registro.otros) ? registro.otros : [];
    state.unidadesObtenidas = registro.unidadesObtenidas || null;

    document.getElementById('nombreProductoCostos').textContent = state.producto || 'esto';
    renderListaCostos();
    renderListaOtros();
    calcularYMostrarResultado();
    irAPantalla('resultado');
  }

  /* ---------------------------------------------------------
     11. Navegación general (volver / empezar)
     --------------------------------------------------------- */

  document.getElementById('btnEmpezar').addEventListener('click', function () {
    irAPantalla('producto');
  });

  document.querySelectorAll('[data-back]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      irAPantalla(btn.getAttribute('data-back'));
    });
  });

  // Cerrar modales al tocar el fondo oscuro
  modalCosto.addEventListener('click', function (e) {
    if (e.target === modalCosto) cerrarModalCosto();
  });
  modalOtro.addEventListener('click', function (e) {
    if (e.target === modalOtro) cerrarModalOtro();
  });

  // Cerrar modales con Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!modalCosto.hidden) cerrarModalCosto();
      if (!modalOtro.hidden) cerrarModalOtro();
    }
  });

  /* ---------------------------------------------------------
     12. Inicialización
     --------------------------------------------------------- */

  function iniciar() {
    renderListaCostos();
    renderListaOtros();
    renderHistorial();
    irAPantalla('inicio');
    ocultarPantallaCarga();
  }

  iniciar();

  } catch (errorFatal) {
    // Red de seguridad final: si algo de todo lo anterior falla,
    // la app nunca debe quedar trabada en la pantalla de carga ni
    // en silencio total. Mostramos un aviso claro y liberamos la UI.
    ocultarPantallaCarga();
    mostrarAvisoInicioFallido();
    if (window.console && console.error) console.error('Error al iniciar ¿Cuánto me cuesta?:', errorFatal);
  }

})();
