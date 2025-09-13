from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.utils.dateparse import parse_datetime
from django.utils.timezone import now
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
import json
from datetime import timezone
from django.utils import timezone as dj_timezone

from .models import Note, Event, Idempotency
from .serializers import MutationSerializer
from django.core.paginator import Paginator

@api_view(['GET'])
def sync(request):
    cursor = request.GET.get('cursor') or ''
    try:
        since = parse_datetime(cursor) if cursor else None
        if since is None:
            # Use epoch time in UTC, then convert to local timezone
            since = dj_timezone.datetime(1970, 1, 1, tzinfo=timezone.utc)
        if timezone.is_naive(since):
            since = timezone.make_aware(since)
    except Exception:
        # Use epoch time in UTC, then convert to local timezone
        since = dj_timezone.datetime(1970, 1, 1, tzinfo=timezone.utc)

    events = Event.objects.filter(updated_at__gt=since).order_by('updated_at', 'id')
    changes = []
    for ev in events:
        if ev.entity_type == 'note':
            try:
                note = Note.objects.get(pk=ev.entity_id)
            except Note.DoesNotExist:
                continue
            changes.append(note.to_change())
    next_cursor = now().isoformat()
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
                    note.updated_at = now()
                    note.save()
                    Event.objects.create(entity_type='note', entity_id=note.id, op='upsert', version=note.version, updated_at=note.updated_at)
                    resp = {"status":"ok","entity":{"id":note.id,"title":note.title,"content":note.content,"version":note.version,"updated_at":note.updated_at.isoformat()}}
            except Note.DoesNotExist:
                note = Note.objects.create(id=entity_id, title=patch.get('title',''), content=patch.get('content',''), version=1, updated_at=now())
                Event.objects.create(entity_type='note', entity_id=note.id, op='upsert', version=note.version, updated_at=note.updated_at)
                resp = {"status":"ok","entity":{"id":note.id,"title":note.title,"content":note.content,"version":note.version,"updated_at":note.updated_at.isoformat()}}
    else:
        resp = {"status":"ok"}

    Idempotency.objects.create(key=idempotency_key, response_json=json.dumps(resp))
    return JsonResponse(resp)

@api_view(['GET'])
def fetch_notes(request):
    """
    Fetch all notes from the database with optional pagination and filtering
    Query parameters:
    - page: Page number (default: 1)
    - limit: Number of notes per page (default: 50, max: 100)
    - status: Filter by status (synced, pending, conflict)
    - search: Search in title and content
    """
    try:
        # Get query parameters
        page = int(request.GET.get('page', 1))
        limit = min(int(request.GET.get('limit', 50)), 100)  # Max 100 per page
        status_filter = request.GET.get('status')
        search_query = request.GET.get('search', '').strip()
        
        # Start with all notes
        notes_query = Note.objects.all().order_by('-updated_at')
        
        # Apply search filter if provided
        if search_query:
            notes_query = notes_query.filter(
                Q(title__icontains=search_query) | Q(content__icontains=search_query)
            )
        
        # Apply status filter if provided (this would need to be implemented based on your status tracking)
        # For now, we'll just return all notes as the status is tracked in the frontend
        
        # Paginate results
        paginator = Paginator(notes_query, limit)
        page_obj = paginator.get_page(page)
        
        # Convert notes to response format
        notes_data = []
        for note in page_obj:
            notes_data.append({
                'id': note.id,
                'title': note.title,
                'content': note.content,
                'version': note.version,
                'updated_at': note.updated_at.isoformat(),
                'created_at': note.updated_at.isoformat()  # Using updated_at as created_at for now
            })
        
        # Prepare response
        response_data = {
            'notes': notes_data,
            'pagination': {
                'current_page': page_obj.number,
                'total_pages': paginator.num_pages,
                'total_notes': paginator.count,
                'has_next': page_obj.has_next(),
                'has_previous': page_obj.has_previous(),
                'limit': limit
            }
        }
        
        return Response(response_data)
        
    except Exception as e:
        return Response(
            {"error": "Failed to fetch notes", "detail": str(e)}, 
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
