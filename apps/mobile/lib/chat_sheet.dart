import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import 'realtime_service.dart';
import 'mototaxi_icon.dart';

Future<void> showTripChat({
  required BuildContext context,
  required String tripId,
  required String userId,
  required bool isDriver,
  required RealtimeService realtime,
  required Future<List<dynamic>> Function() loadHistory,
  required Future<dynamic> Function(String clientMessageId, String body)
      sendFallback,
}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => FractionallySizedBox(
        heightFactor: .88,
        child: _TripChat(
          tripId: tripId,
          userId: userId,
          isDriver: isDriver,
          realtime: realtime,
          loadHistory: loadHistory,
          sendFallback: sendFallback,
        ),
      ),
    );

class _TripChat extends StatefulWidget {
  const _TripChat({
    required this.tripId,
    required this.userId,
    required this.isDriver,
    required this.realtime,
    required this.loadHistory,
    required this.sendFallback,
  });

  final String tripId;
  final String userId;
  final bool isDriver;
  final RealtimeService realtime;
  final Future<List<dynamic>> Function() loadHistory;
  final Future<dynamic> Function(String clientMessageId, String body)
      sendFallback;

  @override
  State<_TripChat> createState() => _TripChatState();
}

class _TripChatState extends State<_TripChat> {
  final input = TextEditingController();
  final scroll = ScrollController();
  final List<Map<String, dynamic>> messages = [];
  StreamSubscription<Map<String, dynamic>>? subscription;
  bool loading = true;
  bool sending = false;

  List<_QuickReply> get quickReplies => widget.isDriver
      ? const [
          _QuickReply('Ya llegué', Icons.location_on_outlined),
          _QuickReply('Estoy en la entrada', Icons.door_front_door_outlined),
          _QuickReply('Voy en camino', null),
        ]
      : const [
          _QuickReply('Salgo ahora', Icons.directions_walk_outlined),
          _QuickReply('No logro verte', Icons.visibility_off_outlined),
          _QuickReply('Voy en camino', Icons.route_outlined),
        ];

  @override
  void initState() {
    super.initState();
    subscription = widget.realtime.events.listen(_event);
    widget.realtime.subscribeTrip(widget.tripId);
    widget.realtime.markRead(widget.tripId);
    _load();
  }

  Future<void> _load() async {
    try {
      final loaded = await widget.loadHistory();
      if (!mounted) return;
      setState(() {
        messages
          ..clear()
          ..addAll(loaded.map((item) => Map<String, dynamic>.from(item)));
        loading = false;
      });
      _bottom();
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  void _event(Map<String, dynamic> event) {
    if (!mounted) return;
    if (event['type'] == 'chat:message') {
      final value = Map<String, dynamic>.from(event['message'] as Map);
      if (value['tripId'] != widget.tripId) return;
      value['mine'] = value['senderId'] == widget.userId;
      _add(value);
    } else if (event['type'] == 'chat:ack') {
      final value = Map<String, dynamic>.from(event['message'] as Map);
      if (value['tripId'] != widget.tripId) return;
      value['mine'] = true;
      _add(value);
    } else if (event['type'] == 'chat:read' &&
        event['tripId'] == widget.tripId) {
      setState(() {
        for (final message in messages) {
          if (message['mine'] == true) message['readAt'] = event['readAt'];
        }
      });
    }
  }

  void _add(Map<String, dynamic> value) {
    final id = value['id']?.toString();
    if (id != null && messages.any((item) => item['id']?.toString() == id)) {
      return;
    }
    setState(() => messages.add(value));
    widget.realtime.markRead(widget.tripId);
    _bottom();
  }

  void _bottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (scroll.hasClients) {
          scroll.animateTo(scroll.position.maxScrollExtent,
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeOut);
        }
      });

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex =
        bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<void> _send([String? quick]) async {
    final body = (quick ?? input.text).trim();
    if (body.isEmpty || sending) return;
    setState(() => sending = true);
    input.clear();
    final clientId = _uuid();
    try {
      if (!widget.realtime.sendMessage(widget.tripId, clientId, body)) {
        final message = await widget.sendFallback(clientId, body);
        _add(Map<String, dynamic>.from(message as Map)..['mine'] = true);
      }
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  void dispose() {
    subscription?.cancel();
    input.dispose();
    scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return AnimatedPadding(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Material(
        color: colors.surface,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
            child: Row(children: [
              CircleAvatar(
                backgroundColor: colors.primaryContainer,
                foregroundColor: colors.onPrimaryContainer,
                child: const Icon(Icons.chat_bubble_outline),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Chat del viaje',
                        style: theme.textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    Text('Conversa sin compartir tu número personal',
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: colors.onSurfaceVariant)),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Cerrar chat',
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ]),
          ),
          SizedBox(
            height: 42,
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              scrollDirection: Axis.horizontal,
              itemCount: quickReplies.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (_, index) {
                final reply = quickReplies[index];
                return ActionChip(
                  avatar: reply.icon == null
                      ? const MototaxiIcon(size: 16)
                      : Icon(reply.icon, size: 16),
                  visualDensity: VisualDensity.compact,
                  label: Text(reply.label),
                  onPressed: sending ? null : () => _send(reply.label),
                );
              },
            ),
          ),
          Container(
            margin: const EdgeInsets.fromLTRB(12, 10, 12, 8),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(
              color: colors.primaryContainer.withValues(alpha: .45),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: colors.outlineVariant),
            ),
            child: Row(children: [
              Icon(Icons.lock_outline, size: 19, color: colors.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Este chat es solo para este viaje. No compartas datos personales.',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: colors.onSurfaceVariant),
                ),
              ),
            ]),
          ),
          Row(children: [
            Expanded(child: Divider(indent: 16, color: colors.outlineVariant)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text('Hoy',
                  style: theme.textTheme.labelSmall
                      ?.copyWith(color: colors.onSurfaceVariant)),
            ),
            Expanded(
                child: Divider(endIndent: 16, color: colors.outlineVariant)),
          ]),
          Expanded(
            child: loading
                ? const Center(child: CircularProgressIndicator())
                : messages.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 88,
                                height: 88,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: colors.surfaceContainerHighest,
                                ),
                                child: Icon(Icons.forum_outlined,
                                    size: 43, color: colors.primary),
                              ),
                              const SizedBox(height: 18),
                              Text('Aún no hay mensajes',
                                  style: theme.textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w800)),
                              const SizedBox(height: 4),
                              Text('Escribe para iniciar la conversación.',
                                  textAlign: TextAlign.center,
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                      color: colors.onSurfaceVariant)),
                            ],
                          ),
                        ),
                      )
                    : ListView.builder(
                        controller: scroll,
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                        itemCount: messages.length,
                        itemBuilder: (_, index) {
                          final message = messages[index];
                          final mine = message['mine'] == true;
                          return Align(
                            alignment: mine
                                ? Alignment.centerRight
                                : Alignment.centerLeft,
                            child: Container(
                              constraints: const BoxConstraints(maxWidth: 290),
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: mine
                                    ? colors.primary
                                    : colors.surfaceContainerHighest,
                                borderRadius: BorderRadius.only(
                                  topLeft: const Radius.circular(16),
                                  topRight: const Radius.circular(16),
                                  bottomLeft: Radius.circular(mine ? 16 : 4),
                                  bottomRight: Radius.circular(mine ? 4 : 16),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (!mine &&
                                      (message['senderName']?.toString() ?? '')
                                          .isNotEmpty)
                                    Text(message['senderName'].toString(),
                                        style: theme.textTheme.labelSmall),
                                  Text(message['body']?.toString() ?? '',
                                      style: TextStyle(
                                          color: mine
                                              ? colors.onPrimary
                                              : colors.onSurface)),
                                  if (mine)
                                    Align(
                                      alignment: Alignment.centerRight,
                                      child: Icon(
                                        message['readAt'] == null
                                            ? Icons.done
                                            : Icons.done_all,
                                        size: 15,
                                        color: colors.onPrimary,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
              child: Row(children: [
                Expanded(
                  child: TextField(
                    controller: input,
                    maxLength: 500,
                    minLines: 1,
                    maxLines: 3,
                    textInputAction: TextInputAction.send,
                    decoration: const InputDecoration(
                      hintText: 'Escribe un mensaje…',
                      counterText: '',
                      isDense: true,
                    ),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  tooltip: 'Enviar mensaje',
                  onPressed: sending ? null : _send,
                  icon: sending
                      ? const SizedBox.square(
                          dimension: 17,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.send_rounded),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

class _QuickReply {
  const _QuickReply(this.label, this.icon);
  final String label;
  final IconData? icon;
}
