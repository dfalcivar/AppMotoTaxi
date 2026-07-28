import 'package:flutter/material.dart';

void main() {
  runApp(const MototaxiApp());
}

class MototaxiApp extends StatelessWidget {
  const MototaxiApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF087F8C);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Mototaxi Atacames',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: seed),
        scaffoldBackgroundColor: const Color(0xFFF1F6F7),
        useMaterial3: true,
      ),
      home: const WelcomeScreen(),
    );
  }
}

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: const Color(0xFF0B3B49),
                  borderRadius: BorderRadius.circular(22),
                ),
                child: const Icon(
                  Icons.two_wheeler_rounded,
                  color: Colors.white,
                  size: 38,
                ),
              ),
              const SizedBox(height: 28),
              Text(
                'Muévete por\nAtacames',
                style: Theme.of(context).textTheme.displaySmall?.copyWith(
                      color: const Color(0xFF0B3B49),
                      fontWeight: FontWeight.w800,
                      height: 1.05,
                    ),
              ),
              const SizedBox(height: 14),
              Text(
                'Solicita una mototaxi cercana, conoce el valor antes de viajar y paga en efectivo.',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: const Color(0xFF587078),
                      height: 1.45,
                    ),
              ),
              const Spacer(),
              FilledButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const PassengerQuoteScreen(),
                  ),
                ),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(56),
                  backgroundColor: const Color(0xFF0B3B49),
                ),
                child: const Text('Solicitar una mototaxi'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () {},
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(56),
                ),
                child: const Text('Ingresar como conductor'),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}

class PassengerQuoteScreen extends StatefulWidget {
  const PassengerQuoteScreen({super.key});

  @override
  State<PassengerQuoteScreen> createState() => _PassengerQuoteScreenState();
}

class _PassengerQuoteScreenState extends State<PassengerQuoteScreen> {
  int passengers = 1;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Solicitar viaje')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            height: 230,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              color: const Color(0xFFDCEAEC),
            ),
            child: const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.map_outlined, size: 54, color: Color(0xFF087F8C)),
                  SizedBox(height: 10),
                  Text('Mapa y ubicación de recogida'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 18),
          const TextField(
            decoration: InputDecoration(
              labelText: '¿Dónde te recogemos?',
              prefixIcon: Icon(Icons.my_location),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          const TextField(
            decoration: InputDecoration(
              labelText: '¿A dónde vas?',
              prefixIcon: Icon(Icons.location_on_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 22),
          Text(
            'Pasajeros',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 1, label: Text('1')),
              ButtonSegment(value: 2, label: Text('2')),
              ButtonSegment(value: 3, label: Text('3')),
            ],
            selected: {passengers},
            onSelectionChanged: (value) {
              setState(() => passengers = value.first);
            },
          ),
          const SizedBox(height: 22),
          Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              title: const Text('El servidor calculará la tarifa'),
              subtitle: Text('$passengers pasajero(s) · pago en efectivo'),
              trailing: const Icon(Icons.chevron_right),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: null,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(54),
            ),
            child: const Text('Selecciona origen y destino'),
          ),
        ],
      ),
    );
  }
}
