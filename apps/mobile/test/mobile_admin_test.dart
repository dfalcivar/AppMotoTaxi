import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/mobile_admin.dart';

Future<dynamic> successfulRequest(String method, String path,
    {String? token, Object? body}) async {
  if (path == '/v1/mobile-admin/session') {
    return {
      'token': 'admin-token',
      'modules': ['overview', 'dispatch', 'arrival', 'simulator', 'audit']
    };
  }
  if (path == '/v1/admin/operations') {
    return {
      'metrics': {
        'connectedDrivers': 4,
        'activeTrips': 2,
        'searchingTrips': 1,
        'upcomingScheduled': 3
      },
      'activeTrips': []
    };
  }
  throw StateError('Unexpected request: $method $path');
}

void main() {
  testWidgets('muestra solo módulos autorizados y datos confirmados por API',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: ThemeData.light(useMaterial3: true),
        home: const MobileAdminPanel(
            mobileToken: 'mobile', request: successfulRequest)));
    await tester.pumpAndSettle();
    expect(find.text('Administración Costa-Go'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('Búsqueda de mototaxis'), findsOneWidget);
    expect(find.text('Tarifa de llegada'), findsOneWidget);
    expect(find.text('Publicidad'), findsNothing);
  });

  testWidgets('presenta error recuperable cuando backend rechaza el acceso',
      (tester) async {
    Future<dynamic> denied(String method, String path,
            {String? token, Object? body}) async =>
        throw StateError('MOBILE_ADMIN_FORBIDDEN');
    await tester.pumpWidget(MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: MobileAdminPanel(mobileToken: 'mobile', request: denied)));
    await tester.pumpAndSettle();
    expect(find.textContaining('MOBILE_ADMIN_FORBIDDEN'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
  });
}
