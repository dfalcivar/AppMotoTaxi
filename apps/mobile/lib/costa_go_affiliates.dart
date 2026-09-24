import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'affiliate_banners.dart';
import 'costa_go_coastal.dart';
import 'costa_go_design.dart';

/// Reuses the paid-banner renderer, weighting, rotation and event callbacks.
class CostaGoAffiliatesScreen extends StatefulWidget {
  const CostaGoAffiliatesScreen(
      {super.key,
      required this.load,
      required this.imageUrl,
      required this.onTap,
      required this.onImpression});
  final Future<List<dynamic>> Function() load;
  final String Function(Map<String, dynamic>) imageUrl;
  final ValueChanged<Map<String, dynamic>> onTap, onImpression;
  @override
  State<CostaGoAffiliatesScreen> createState() =>
      _CostaGoAffiliatesScreenState();
}

class _CostaGoAffiliatesScreenState extends State<CostaGoAffiliatesScreen> {
  int revision = 0;
  @override
  Widget build(BuildContext context) => CostaGoScaffold(
      appBar: AppBar(title: const Text('Comercios afiliados'), actions: [
        IconButton(
            tooltip: 'Actualizar',
            onPressed: () => setState(() => revision++),
            icon: const Icon(Icons.refresh))
      ]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        const Text('Descubre negocios y servicios cerca de ti.'),
        const SizedBox(height: 20),
        AffiliateBanners(
          key: ValueKey(revision),
          load: widget.load,
          imageUrl: widget.imageUrl,
          onTap: widget.onTap,
          onImpression: widget.onImpression,
          errorBuilder: (context) => CostaGoSurface(
              child: Column(children: [
            const Icon(Icons.cloud_off_outlined, size: 40),
            const SizedBox(height: 12),
            const Text('No pudimos consultar los comercios.'),
            TextButton(
                onPressed: () => setState(() => revision++),
                child: const Text('Reintentar'))
          ])),
          emptyBuilder: (context) => CostaGoSurface(
              child: Column(children: [
            const CostaGoIconBadge(icon: Icons.storefront_outlined, size: 64),
            const SizedBox(height: 20),
            Text('Aún no hay comercios afiliados en tu zona',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            const Text('Estamos sumando nuevos negocios a Costa-Go.',
                textAlign: TextAlign.center),
            const Divider(height: 40),
            Text('¿Tienes un negocio?',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            const Text('Afílialo y llega a más personas de tu zona.',
                textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.icon(
                icon: const Icon(Icons.open_in_new),
                label: const Text('Afiliar mi comercio'),
                onPressed: () async {
                  try {
                    if (await launchUrl(
                        Uri.parse('https://costa-go.com/comercios'),
                        mode: LaunchMode.externalApplication)) {
                      return;
                    }
                  } catch (_) {}
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text('No se pudo abrir el navegador.')));
                  }
                })
          ])),
        ),
      ]));
}
