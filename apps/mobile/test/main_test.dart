import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/main.dart';

void main() {
  test('traduce todos los estados operativos visibles', () {
    expect(estadoViaje('SEARCHING'), 'Buscando conductor');
    expect(estadoViaje('DRIVER_EN_ROUTE'), 'Conductor en camino');
    expect(estadoViaje('DRIVER_ARRIVED'), 'Conductor llegó');
    expect(estadoViaje('IN_PROGRESS'), 'Viaje en curso');
    expect(estadoViaje('COMPLETED'), 'Finalizado');
    expect(estadoViaje('CANCELLED'), 'Cancelado');
  });

  test('presenta errores de sesión en español', () {
    expect(
        mensajeApi('INVALID_CREDENTIALS'), 'Correo o contraseña incorrectos.');
    expect(mensajeApi('DRIVER_PENDING_APPROVAL'),
        'Tu perfil de conductor está pendiente de aprobación.');
    expect(mensajeApi('SESSION_REPLACED'), contains('otro dispositivo'));
    expect(mensajeApi('INVALID_REGISTRATION'), contains('campos obligatorios'));
    expect(mensajeApi('VEHICLE_REQUIRED'), contains('placa'));
  });
}
