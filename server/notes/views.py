from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
import json

from .models import Note, Event, Idempotency
from .serializers import MutationSerializer

@api_view(['GET'])
def sync(request):
    cursor = request.GET.get('cursor') or ''
    try:
        since = parse_datetime(cursor) if cursor else None
        if since is None:
            since = timezone.make_aware(timezone.datetime.fromtimestamp(0))
        if timezone.is_naive(since):
            since = timezone.make_aware(since)
    except Exception:
        since = timezone.make_aware(timezone.datetime.fromtimestamp(0))

    events = Event.objects.filter(updated_at__gt=since).order_by('updated_at', 'id')
    changes = []
    for ev in events:
        if ev.entity_type == 'note':
            try:
                note = Note.objects.get(pk=ev.entity_id)
            except Note.DoesNotExist:
                continue
            changes.append(note.to_change())
    next_cursor = timezone.now().isoformat()
    return Response({"changes": changes, "next_cursor": next_cursor})

@api_view(['POST'])
def mutations(request):
    idempotency_key = request.headers.get('Idempotency-Key')
    if not idempotency_key:
        return Response({"detail":"Missing Idempotency-Key"}, status=400)

    existing = Idempotency.objects.filter(pk=idempotency_key).first()
    if existing:
        return JsonResponse(json.loads(existing.response_json))

    payload = request.data
    ser = MutationSerializer(data=payload)
    ser.is_valid(raise_exception=True)

    entity_type = ser.validated_data['entity_type']
    entity_id = ser.validated_data['entity_id']
    patch = ser.validated_data.get('patch', {})
    base_version = ser.validated_data.get('base_version', 0)

    if entity_type == 'note':
        with transaction.atomic():
            try:
                note = Note.objects.select_for_update().get(pk=entity_id)
                if base_version < note.version:
                    resp = {"status":"conflict","reason":"base_version_stale","server_version":note.version}
                else:
                    note.title = patch.get('title', note.title)
                    note.content = patch.get('content', note.content)
                    note.version = note.version + 1
                    note.updated_at = timezone.now()
                    note.save()
                    Event.objects.create(entity_type='note', entity_id=note.id, op='upsert', version=note.version, updated_at=note.updated_at)
                    resp = {"status":"ok","entity":{"id":note.id,"title":note.title,"content":note.content,"version":note.version,"updated_at":note.updated_at.isoformat()}}
            except Note.DoesNotExist:
                note = Note.objects.create(id=entity_id, title=patch.get('title',''), content=patch.get('content',''), version=1, updated_at=timezone.now())
                Event.objects.create(entity_type='note', entity_id=note.id, op='upsert', version=note.version, updated_at=note.updated_at)
                resp = {"status":"ok","entity":{"id":note.id,"title":note.title,"content":note.content,"version":note.version,"updated_at":note.updated_at.isoformat()}}
    else:
        resp = {"status":"ok"}

    Idempotency.objects.create(key=idempotency_key, response_json=json.dumps(resp))
    return JsonResponse(resp)
