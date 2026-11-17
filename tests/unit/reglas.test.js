/** Pruebas unitarias: reglas de negocio puras (RUT, patentes y cupos). */
import '../ayuda/entorno.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validarRut, limpiarRut, formatearRut, enmascararRut, digitoVerificador } from '../../src/lib/rut.js';
import { validarPatente, limpiarPatente, formatearPatente } from '../../src/lib/patente.js';
import { validarCupos, cuposTrasSubida, cuposTrasBajada, estadoCupos, recibeAvisos, ocupacion, ErrorCupos } from '../../src/lib/cupos.js';

describe('RUT chileno (módulo 11)', () => {
  test('acepta RUT válidos con y sin puntos ni guion', () => {
    assert.equal(validarRut('12.345.678-5'), true);
    assert.equal(validarRut('123456785'), true);
    assert.equal(validarRut('11.111.111-1'), true);
  });

  test('acepta dígito verificador K (mayúscula o minúscula) y 0', () => {
    assert.equal(digitoVerificador('10000013'), 'K');
    assert.equal(validarRut('10.000.013-k'), true);
    assert.equal(digitoVerificador('10000004'), '0');
    assert.equal(validarRut('10000004-0'), true);
  });

  test('rechaza dígito verificador incorrecto', () => {
    assert.equal(validarRut('12.345.678-9'), false);
    assert.equal(validarRut('11.111.111-2'), false);
  });

  test('rechaza formatos inválidos, vacíos e intentos de inyección', () => {
    for (const malo of ['', null, undefined, 'abc', '1-9', '00000000-0', "1' OR '1'='1", '12.345.678-55']) {
      assert.equal(validarRut(malo), false, `debió rechazar: ${malo}`);
    }
  });

  test('normaliza, formatea y enmascara', () => {
    assert.equal(limpiarRut(' 12.345.678-k '), '12345678K');
    assert.equal(formatearRut('123456785'), '12.345.678-5');
    assert.equal(enmascararRut('123456785'), '••.•••.678-5');
  });
});

describe('Patentes chilenas', () => {
  test('acepta formato actual (4 letras + 2 números) y antiguo (2 letras + 4 números)', () => {
    assert.equal(validarPatente('BBCL12'), true);
    assert.equal(validarPatente('hj-kl-45'), true);
    assert.equal(validarPatente('AB1234'), true);
  });

  test('rechaza letras no usadas en el formato actual, largos incorrectos y símbolos', () => {
    for (const mala of ['AEIO12', 'BBCL1', 'BBCL123', '123456', '', 'BB CL 1Z', "';DROP--"]) {
      assert.equal(validarPatente(mala), false, `debió rechazar: ${mala}`);
    }
  });

  test('normaliza y formatea como se lee en la placa', () => {
    assert.equal(limpiarPatente(' hj·kl·45 '), 'HJKL45');
    assert.equal(formatearPatente('HJKL45'), 'HJ·KL·45');
  });
});

describe('Cupos del colectivo', () => {
  test('caso del plan de pruebas: capacidad 4, suben 2, quedan 2', () => {
    assert.equal(cuposTrasSubida(4, 2), 2);
  });

  test('no puede subir más gente que asientos libres', () => {
    assert.throws(() => cuposTrasSubida(1, 2), ErrorCupos);
    assert.throws(() => cuposTrasSubida(2, -1), ErrorCupos);
    assert.throws(() => cuposTrasSubida(2, 1.5), ErrorCupos);
  });

  test('al bajar pasajeros nunca se supera la capacidad', () => {
    assert.equal(cuposTrasBajada(3, 1, 4), 4);
    assert.equal(cuposTrasBajada(3, 3, 4), 4);
  });

  test('valida el rango 0..capacidad y que sea entero', () => {
    assert.equal(validarCupos(0, 4), 0);
    assert.equal(validarCupos(4, 4), 4);
    assert.throws(() => validarCupos(5, 4), ErrorCupos);
    assert.throws(() => validarCupos(-1, 4), ErrorCupos);
    assert.throws(() => validarCupos(2.5, 4), ErrorCupos);
    assert.throws(() => validarCupos('2', 4), ErrorCupos);
  });

  test('estado visible para el pasajero: lleno, último asiento o disponible', () => {
    assert.equal(estadoCupos(0), 'lleno');
    assert.equal(estadoCupos(1), 'ultimo');
    assert.equal(estadoCupos(3), 'disponible');
  });

  test('un vehículo lleno no recibe avisos de pasajeros (HU-02)', () => {
    assert.equal(recibeAvisos(0), false);
    assert.equal(recibeAvisos(1), true);
  });

  test('ocupación de la flota en porcentaje', () => {
    assert.equal(ocupacion([]), 0);
    assert.equal(ocupacion([{ capacidad: 4, cupos: 4 }]), 0);
    assert.equal(ocupacion([{ capacidad: 4, cupos: 0 }]), 100);
    assert.equal(ocupacion([{ capacidad: 4, cupos: 1 }, { capacidad: 4, cupos: 3 }]), 50);
  });
});
